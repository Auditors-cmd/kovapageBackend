const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const { sendOTPEmail, sendWelcomeEmail, sendPasswordResetEmail } = require('../utils/emailService');
const { createOTP, verifyOTP } = require('../utils/otpService');
const { protect } = require('../middleware/auth');
const { hasRoleLevel } = require('../middleware/roles');
const upload = require('../middleware/upload');

const router = express.Router();

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'dev-secret-key', { expiresIn: '30d' });
};

// Email validation function
const isValidEmail = (email) => {
  const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
  return emailRegex.test(email);
};

// Valid roles constant for reuse
const VALID_ROLES = [
  'auditee', 'implementation_officer', 'team_member', 'team_lead',
  'quality_assurance', 'unit_head', 'bac_secretariat', 'chief_audit_executive'
];

// Dashboard mapping based on user role
const getDashboardByRole = (role) => {
  const dashboards = {
    'quality_assurance': '/qa/dashboard',
    'unit_head': '/unit-head/dashboard',
    'chief_audit_executive': '/cae/dashboard',
    'bac_secretariat': '/bac/dashboard',
    'team_lead': '/team-lead/dashboard',
    'team_member': '/team-member/dashboard',
    'implementation_officer': '/implementation/dashboard',
    'auditee': '/auditee/dashboard'
  };
  return dashboards[role] || '/dashboard';
};

// Welcome messages for each role
const getWelcomeMessage = (role, name) => {
  const messages = {
    'quality_assurance': `Welcome to QA Dashboard, ${name}! You can monitor risk assessments and consolidate audit plans.`,
    'unit_head': `Welcome to Unit Head Dashboard, ${name}! You can manage your team and review audit progress.`,
    'chief_audit_executive': `Welcome to CAE Dashboard, ${name}! You have executive oversight of all audit activities.`,
    'bac_secretariat': `Welcome to BAC Dashboard, ${name}! You can manage committee meetings and documentation.`,
    'team_lead': `Welcome to Team Lead Dashboard, ${name}! You can assign tasks and review team work.`,
    'team_member': `Welcome to Team Member Dashboard, ${name}! You can collect evidence and update workpapers.`,
    'implementation_officer': `Welcome to Implementation Dashboard, ${name}! You can track and implement audit recommendations.`,
    'auditee': `Welcome to Auditee Dashboard, ${name}! You can respond to findings and upload evidence.`
  };
  return messages[role] || `Welcome to KovaPage, ${name}!`;
};

// =======================
// PASSWORD AUTHENTICATION
// =======================

// @desc    Register new user with profile photo
// @route   POST /api/auth/register
// @access  Public
router.post('/register', upload.single('profilePhoto'), async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const profilePhoto = req.file;

    // Validation
    if (!name || !email || !password) {
      if (profilePhoto) fs.unlinkSync(profilePhoto.path);
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, and password'
      });
    }

    if (password.length < 8) {
      if (profilePhoto) fs.unlinkSync(profilePhoto.path);
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    if (!isValidEmail(email)) {
      if (profilePhoto) fs.unlinkSync(profilePhoto.path);
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      if (profilePhoto) fs.unlinkSync(profilePhoto.path);
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Prepare user data
    const userData = {
      name: name.trim(),
      email: email.toLowerCase(),
      password,
      authMethod: 'password',
      role: 'auditee',
      isEmailVerified: false,
      isActive: true,
      lastLogin: new Date()
    };

    // Add profile photo if uploaded
    if (profilePhoto) {
      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
      userData.profilePhoto = profilePhoto.filename;
      userData.profilePhotoUrl = `${baseUrl}/uploads/profiles/${profilePhoto.filename}`;
    }

    // Create user
    const user = await User.create(userData);
    const token = generateToken(user.id);

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          profilePhoto: user.profilePhoto,
          profilePhotoUrl: user.profilePhotoUrl,
          isEmailVerified: user.isEmailVerified,
          authMethod: user.authMethod,
          lastLogin: user.lastLogin,
          needsRoleSelection: true
        },
        token
      },
      message: 'User registered successfully! Please complete your profile.'
    });

  } catch (error) {
    console.error('Registration error:', error);
    if (req.file) fs.unlinkSync(req.file.path);
    
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error during registration. Please try again.'
    });
  }
});

// @desc    Login with password
// @route   POST /api/auth/login
// @access  Public
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    const user = await User.findOne({
      where: { 
        email: email.toLowerCase(),
        authMethod: 'password',
        isActive: true
      }
    });
    
    if (user && (await user.matchPassword(password))) {
      await user.update({ lastLogin: new Date() });
      const token = generateToken(user.id);

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            profilePhoto: user.profilePhoto,
            profilePhotoUrl: user.profilePhotoUrl,
            isEmailVerified: user.isEmailVerified,
            authMethod: user.authMethod,
            lastLogin: user.lastLogin,
            needsRoleSelection: user.role === 'auditee' && !user.roleSelectedAt,
            dashboard: getDashboardByRole(user.role)
          },
          token
        },
        message: `Welcome back, ${user.name}!`
      });
    } else {
      res.status(401).json({
        success: false,
        message: 'Invalid credentials. Please check your email and password.'
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login. Please try again.'
    });
  }
});

// =======================
// PROFILE PHOTO UPLOAD
// =======================

// @desc    Update profile photo
// @route   PUT /api/auth/update-photo
// @access  Private
router.put('/update-photo', protect, upload.single('profilePhoto'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a profile photo'
      });
    }

    const user = await User.findByPk(req.user.id);
    
    // Delete old photo if exists
    if (user.profilePhoto) {
      const oldPhotoPath = path.join('uploads/profiles', user.profilePhoto);
      if (fs.existsSync(oldPhotoPath)) {
        fs.unlinkSync(oldPhotoPath);
      }
    }

    // Update with new photo
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    user.profilePhoto = req.file.filename;
    user.profilePhotoUrl = `${baseUrl}/uploads/profiles/${req.file.filename}`;
    await user.save();

    res.json({
      success: true,
      message: 'Profile photo updated successfully',
      data: {
        profilePhoto: user.profilePhoto,
        profilePhotoUrl: user.profilePhotoUrl
      }
    });

  } catch (error) {
    console.error('Update photo error:', error);
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({
      success: false,
      message: 'Error updating profile photo'
    });
  }
});

// =======================
// ROLE SELECTION
// =======================

// @desc    Update user role after registration
// @route   PUT /api/auth/update-role
// @access  Private
router.put('/update-role', protect, async (req, res) => {
  try {
    const { role } = req.body;
    const userId = req.user.id;

    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Please select a valid role from the options.'
      });
    }

    const user = await User.findByPk(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await user.update({ 
      role,
      roleSelectedAt: new Date() 
    });

    res.json({
      success: true,
      message: `Role updated successfully to ${role.replace(/_/g, ' ')}`,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        roleSelectedAt: user.roleSelectedAt,
        dashboard: getDashboardByRole(role),
        welcomeMessage: getWelcomeMessage(role, user.name)
      }
    });

  } catch (error) {
    console.error('Role update error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating role. Please try again.'
    });
  }
});

// @desc    Check if user needs to select role
// @route   GET /api/auth/role-status
// @access  Private
router.get('/role-status', protect, async (req, res) => {
  try {
    const user = req.user;
    const needsRoleSelection = user.role === 'auditee' && !user.roleSelectedAt;

    res.json({
      success: true,
      data: {
        currentRole: user.role,
        needsSelection: needsRoleSelection,
        roleSelectedAt: user.roleSelectedAt,
        availableRoles: VALID_ROLES,
        dashboard: getDashboardByRole(user.role)
      }
    });

  } catch (error) {
    console.error('Role status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking role status'
    });
  }
});

// =======================
// PASSWORD RESET
// =======================

// @desc    Forgot password - request reset
// @route   POST /api/auth/forgot-password
// @access  Public
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email address'
      });
    }

    const user = await User.findOne({
      where: { 
        email: email.toLowerCase(),
        isActive: true
      }
    });
    
    if (!user) {
      return res.json({
        success: true,
        message: 'If an account with that email exists, a reset code has been sent'
      });
    }

    if (user.authMethod !== 'password') {
      return res.status(400).json({
        success: false,
        message: 'Please use OTP authentication for this account'
      });
    }

    const resetOTP = createOTP(email);
    const emailResult = await sendPasswordResetEmail(email, resetOTP, user.name);

    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send reset email. Please try again.'
      });
    }

    res.json({
      success: true,
      message: 'Password reset code sent to your email'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password reset request'
    });
  }
});

// @desc    Reset password with OTP
// @route   POST /api/auth/reset-password
// @access  Public
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email, reset code, and new password'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    const otpVerification = verifyOTP(email, otp);
    if (!otpVerification.isValid) {
      return res.status(400).json({
        success: false,
        message: otpVerification.message || 'Invalid or expired reset code'
      });
    }

    const user = await User.findOne({
      where: { 
        email: email.toLowerCase(),
        isActive: true
      }
    });
    
    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'User not found'
      });
    }

    await user.update({ password: newPassword });

    res.json({
      success: true,
      message: 'Password reset successfully! You can now login with your new password.'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password reset'
    });
  }
});

// =======================
// OTP AUTHENTICATION
// =======================

// @desc    Request OTP for registration
// @route   POST /api/auth/email/register
// @access  Public
router.post('/email/register', upload.single('profilePhoto'), async (req, res) => {
  try {
    const { email, name } = req.body;
    const profilePhoto = req.file;

    if (!email || !name) {
      if (profilePhoto) fs.unlinkSync(profilePhoto.path);
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and name'
      });
    }

    if (!isValidEmail(email)) {
      if (profilePhoto) fs.unlinkSync(profilePhoto.path);
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    if (name.trim().length < 2) {
      if (profilePhoto) fs.unlinkSync(profilePhoto.path);
      return res.status(400).json({
        success: false,
        message: 'Name must be at least 2 characters long'
      });
    }

    const existingUser = await User.findOne({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      if (profilePhoto) fs.unlinkSync(profilePhoto.path);
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists'
      });
    }

    const otp = createOTP(email);
    const emailResult = await sendOTPEmail(email, otp, name);

    if (!emailResult.success) {
      if (profilePhoto) fs.unlinkSync(profilePhoto.path);
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification email. Please try again.',
        error: emailResult.error
      });
    }

    res.json({
      success: true,
      message: `Verification code sent to ${email}`,
      data: {
        email: email.toLowerCase(),
        name: name.trim(),
        hasProfilePhoto: !!profilePhoto
      }
    });

  } catch (error) {
    console.error('Email registration error:', error);
    if (req.file) fs.unlinkSync(req.file.path);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
});

// @desc    Verify OTP and complete registration with photo
// @route   POST /api/auth/email/verify
// @access  Public
router.post('/email/verify', async (req, res) => {
  try {
    const { email, name, otp } = req.body;

    if (!email || !name || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email, name, and verification code'
      });
    }

    if (otp.length !== 6) {
      return res.status(400).json({
        success: false,
        message: 'Verification code must be 6 digits'
      });
    }

    const otpVerification = verifyOTP(email, otp);
    
    if (!otpVerification.isValid) {
      return res.status(400).json({
        success: false,
        message: otpVerification.message
      });
    }

    // Create user
    const userData = {
      name: name.trim(),
      email: email.toLowerCase(),
      isEmailVerified: true,
      authMethod: 'email_otp',
      role: 'auditee',
      isActive: true,
      lastLogin: new Date()
    };

    const user = await User.create(userData);
    const token = generateToken(user.id);

    // Send welcome email (non-blocking)
    sendWelcomeEmail(email, name).catch(console.warn);

    res.status(201).json({
      success: true,
      message: 'Email verified successfully! Please complete your profile.',
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          profilePhoto: user.profilePhoto,
          profilePhotoUrl: user.profilePhotoUrl,
          isEmailVerified: user.isEmailVerified,
          authMethod: user.authMethod,
          lastLogin: user.lastLogin,
          needsRoleSelection: true,
          dashboard: getDashboardByRole(user.role)
        },
        token
      }
    });

  } catch (error) {
    console.error('OTP verification error:', error);
    
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error during verification'
    });
  }
});

// @desc    Request OTP for login
// @route   POST /api/auth/email/login
// @access  Public
router.post('/email/login', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Please provide your email address'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    const user = await User.findOne({
      where: { 
        email: email.toLowerCase(),
        isActive: true 
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email. Please register first.'
      });
    }

    const otp = createOTP(email);
    const emailResult = await sendOTPEmail(email, otp, user.name);

    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification email. Please try again.'
      });
    }

    res.json({
      success: true,
      message: `Verification code sent to ${email}`,
      data: {
        email: email.toLowerCase(),
        name: user.name
      }
    });

  } catch (error) {
    console.error('Email login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

// @desc    Verify OTP for login
// @route   POST /api/auth/email/verify-login
// @access  Public
router.post('/email/verify-login', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and verification code'
      });
    }

    if (otp.length !== 6) {
      return res.status(400).json({
        success: false,
        message: 'Verification code must be 6 digits'
      });
    }

    const otpVerification = verifyOTP(email, otp);
    
    if (!otpVerification.isValid) {
      return res.status(400).json({
        success: false,
        message: otpVerification.message
      });
    }

    const user = await User.findOne({
      where: { email: email.toLowerCase() }
    });
    
    await user.update({ lastLogin: new Date() });
    const token = generateToken(user.id);

    res.json({
      success: true,
      message: `Welcome back, ${user.name}!`,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          profilePhoto: user.profilePhoto,
          profilePhotoUrl: user.profilePhotoUrl,
          isEmailVerified: user.isEmailVerified,
          authMethod: user.authMethod,
          lastLogin: user.lastLogin,
          needsRoleSelection: user.role === 'auditee' && !user.roleSelectedAt,
          dashboard: getDashboardByRole(user.role)
        },
        token
      }
    });

  } catch (error) {
    console.error('Login OTP verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login verification'
    });
  }
});

// =======================
// USER PROFILE & STATUS
// =======================

// @desc    Get user profile
// @route   GET /api/auth/profile
// @access  Private
router.get('/profile', protect, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      data: {
        ...user.toJSON(),
        needsRoleSelection: user.role === 'auditee' && !user.roleSelectedAt,
        dashboard: getDashboardByRole(user.role)
      }
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user profile'
    });
  }
});

// @desc    Check authentication status
// @route   GET /api/auth/status
// @access  Private
router.get('/status', protect, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      isAuthenticated: true,
      data: {
        ...user.toJSON(),
        needsRoleSelection: user.role === 'auditee' && !user.roleSelectedAt,
        dashboard: getDashboardByRole(user.role),
        welcomeMessage: getWelcomeMessage(user.role, user.name)
      }
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking authentication status'
    });
  }
});

// =======================
// ADMIN ROUTES
// =======================

// @desc    Get all users (Admin only)
// @route   GET /api/auth/admin/users
// @access  Private (BAC/CAE only)
router.get('/admin/users', protect, hasRoleLevel('bac_secretariat'), async (req, res) => {
  try {
    const { role, department, isActive, search } = req.query;
    
    const where = {};
    if (role) where.role = role;
    if (department) where.department = department;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { employeeId: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const users = await User.findAll({
      where,
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      count: users.length,
      data: users
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching users'
    });
  }
});

// @desc    Get users pending role assignment
// @route   GET /api/auth/admin/pending-users
// @access  Private (BAC/CAE only)
router.get('/admin/pending-users', protect, hasRoleLevel('bac_secretariat'), async (req, res) => {
  try {
    const pendingUsers = await User.findAll({
      where: {
        role: 'auditee',
        roleSelectedAt: null,
        isActive: true
      },
      attributes: { exclude: ['password'] },
      order: [['createdAt', 'DESC']]
    });

    res.json({
      success: true,
      count: pendingUsers.length,
      data: pendingUsers
    });

  } catch (error) {
    console.error('Get pending users error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching pending users'
    });
  }
});

// @desc    Assign role to user (Admin only)
// @route   PUT /api/auth/admin/assign-role/:userId
// @access  Private (BAC/CAE only)
router.put('/admin/assign-role/:userId', protect, hasRoleLevel('bac_secretariat'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { role, department, employeeId, reportsTo } = req.body;

    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be one of: ' + VALID_ROLES.join(', ')
      });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await user.update({
      role,
      department: department || user.department,
      employeeId: employeeId || user.employeeId,
      reportsTo: reportsTo || user.reportsTo,
      roleSelectedAt: new Date()
    });

    res.json({
      success: true,
      message: `Role ${role} assigned to ${user.name}`,
      data: user
    });

  } catch (error) {
    console.error('Role assignment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error assigning role'
    });
  }
});

module.exports = router;
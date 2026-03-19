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
const { hasRoleLevel, roleHierarchy } = require('../middleware/roles');
const { uploadProfilePhoto, deleteFromCloudinary } = require('../middleware/upload'); // Updated import

const router = express.Router();

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
const ADMIN_BOOTSTRAP_ROLES = ['bac_secretariat', 'chief_audit_executive'];

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

const resolveJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  const weakSecret = !secret || secret === 'dev-secret-key' || String(secret).includes('change_this_in_production');

  if (process.env.NODE_ENV === 'production' && weakSecret) {
    throw new Error('JWT_SECRET is not configured securely for production');
  }

  return secret || 'dev-secret-key';
};

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, resolveJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
};

const normalizeEmail = (email) => String(email || '').toLowerCase().trim();

const canAssignRole = (actorRole, roleToAssign) => {
  if (!VALID_ROLES.includes(roleToAssign)) return false;
  if (actorRole === 'chief_audit_executive') return true;
  if (actorRole === 'bac_secretariat') {
    return (roleHierarchy[roleToAssign] || 0) < (roleHierarchy.bac_secretariat || 0);
  }
  return false;
};

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
// ADMIN BOOTSTRAP (ONE-TIME)
// =======================

// @desc    Bootstrap initial admin account (one-time, key protected)
// @route   POST /api/auth/bootstrap/admin
// @access  Public (requires x-bootstrap-key)
router.post('/bootstrap/admin', async (req, res) => {
  try {
    const bootstrapKey = String(process.env.ADMIN_BOOTSTRAP_KEY || '').trim();
    if (!bootstrapKey) {
      return res.status(403).json({
        success: false,
        message: 'Admin bootstrap is disabled'
      });
    }

    const providedKey = String(req.headers['x-bootstrap-key'] || '').trim();
    if (!providedKey || providedKey !== bootstrapKey) {
      return res.status(401).json({
        success: false,
        message: 'Invalid bootstrap key'
      });
    }

    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, password, and role'
      });
    }

    if (!ADMIN_BOOTSTRAP_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Bootstrap role must be one of: ${ADMIN_BOOTSTRAP_ROLES.join(', ')}`
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    const normalizedEmail = normalizeEmail(email);

    const existingAdminCount = await User.count({
      where: {
        role: { [Op.in]: ADMIN_BOOTSTRAP_ROLES },
        isActive: true
      }
    });

    if (existingAdminCount > 0) {
      return res.status(409).json({
        success: false,
        message: 'Bootstrap is locked because an active BAC/CAE account already exists'
      });
    }

    const existingUser = await User.findOne({
      where: {
        [Op.or]: [
          { email: normalizedEmail }
        ]
      }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role,
      authMethod: 'password',
      isEmailVerified: true,
      isActive: true,
      roleSelectedAt: new Date()
    });

    const token = generateToken(user.id);

    return res.status(201).json({
      success: true,
      message: `Bootstrap admin account created as ${role}`,
      data: {
        user: toSafeUser(user),
        token
      }
    });
  } catch (error) {
    console.error('Bootstrap admin error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error creating bootstrap admin account'
    });
  }
});

// =======================
// PASSWORD AUTHENTICATION
// =======================

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
// PROFILE PHOTO UPLOAD (Cloudinary)
// =======================

// @desc    Update profile photo
// @route   PUT /api/auth/update-photo
// @access  Private
router.put('/update-photo', protect, uploadProfilePhoto.single('profilePhoto'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a profile photo'
      });
    }

    const user = await User.findByPk(req.user.id);
    
    // Delete old photo from Cloudinary if exists
    if (user.profilePhotoPublicId) {
      await deleteFromCloudinary(user.profilePhotoPublicId);
    }

    // Update with new photo (Cloudinary)
    user.profilePhotoPublicId = req.file.filename;
    user.profilePhotoUrl = req.file.path;
    await user.save();

    res.json({
      success: true,
      message: 'Profile photo updated successfully',
      data: {
        profilePhotoUrl: user.profilePhotoUrl
      }
    });

  } catch (error) {
    console.error('Update photo error:', error);
    // Clean up the newly uploaded file if there was an error
    if (req.file) {
      await deleteFromCloudinary(req.file.filename).catch(console.warn);
    }
    res.status(500).json({
      success: false,
      message: 'Error updating profile photo'
    });
  }
});

// @desc    Delete profile photo
// @route   DELETE /api/auth/delete-photo
// @access  Private
router.delete('/delete-photo', protect, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    
    if (user.profilePhotoPublicId) {
      // Delete from Cloudinary
      await deleteFromCloudinary(user.profilePhotoPublicId);
      
      // Clear from database
      user.profilePhotoPublicId = null;
      user.profilePhotoUrl = null;
      await user.save();
    }

    res.json({
      success: true,
      message: 'Profile photo deleted successfully'
    });

  } catch (error) {
    console.error('Delete photo error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting profile photo'
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

    const normalizedEmail = normalizeEmail(email);

    const user = await User.findOne({
      where: { 
        email: normalizedEmail,
        isActive: true
      }
    });
    
    if (!user) {
      // Don't reveal if user exists or not for security
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

    const resetOTP = await createOTP(normalizedEmail);
    const emailResult = await sendPasswordResetEmail(normalizedEmail, resetOTP, user.name);

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

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    const normalizedEmail = normalizeEmail(email);
    const otpVerification = await verifyOTP(normalizedEmail, otp);
    if (!otpVerification.isValid) {
      return res.status(400).json({
        success: false,
        message: otpVerification.message || 'Invalid or expired reset code'
      });
    }

    const user = await User.findOne({
      where: { 
        email: normalizedEmail,
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

    const normalizedEmail = normalizeEmail(email);

    const user = await User.findOne({
      where: { 
        email: normalizedEmail,
        isActive: true 
      }
    });

    if (!user) {
      return res.json({
        success: true,
        message: 'If an account with that email exists, a verification code has been sent',
        data: {
          email: normalizedEmail
        }
      });
    }

    const otp = await createOTP(normalizedEmail);
    const emailResult = await sendOTPEmail(normalizedEmail, otp, user.name);

    if (!emailResult.success) {
      const errorPayload = {
        success: false,
        message: 'Failed to send verification email. Please try again.'
      };

      if (process.env.NODE_ENV === 'development') {
        errorPayload.error = emailResult.error;
      }

      return res.status(500).json(errorPayload);
    }

    res.json({
      success: true,
      message: `Verification code sent to ${normalizedEmail}`,
      data: {
        email: normalizedEmail,
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

    const normalizedEmail = normalizeEmail(email);
    const otpVerification = await verifyOTP(normalizedEmail, otp);
    
    if (!otpVerification.isValid) {
      return res.status(400).json({
        success: false,
        message: otpVerification.message
      });
    }

    const user = await User.findOne({
      where: { email: normalizedEmail }
    });

    if (!user || !user.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification request'
      });
    }
    
    await user.update({
      lastLogin: new Date(),
      isEmailVerified: true
    });
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

const hasField = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const toSafeUser = (user) => {
  if (!user) return null;
  const safeUser = user.toJSON ? user.toJSON() : { ...user };
  delete safeUser.password;
  return safeUser;
};

const normalizeNullable = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return value;
};

const validateReportsTo = async (reportsTo, currentUserId = null) => {
  const normalizedReportsTo = normalizeNullable(reportsTo);

  if (normalizedReportsTo === undefined) {
    return { valid: true, value: undefined };
  }

  if (normalizedReportsTo === null) {
    return { valid: true, value: null };
  }

  if (currentUserId && normalizedReportsTo === currentUserId) {
    return { valid: false, message: 'User cannot report to themselves' };
  }

  const manager = await User.findByPk(normalizedReportsTo, {
    attributes: ['id', 'name', 'email', 'role', 'department', 'isActive']
  });

  if (!manager) {
    return { valid: false, message: 'reportsTo user not found' };
  }

  return { valid: true, value: normalizedReportsTo, manager };
};

const validateUniqueUserFields = async ({ email, employeeId, excludeUserId = null }) => {
  if (email !== undefined) {
    const normalizedEmail = email.toLowerCase();
    const existingEmailUser = await User.findOne({
      where: {
        email: normalizedEmail,
        ...(excludeUserId ? { id: { [Op.ne]: excludeUserId } } : {})
      },
      attributes: ['id']
    });

    if (existingEmailUser) {
      return { valid: false, message: 'User with this email already exists' };
    }
  }

  if (employeeId !== undefined && employeeId !== null && employeeId !== '') {
    const existingEmployeeUser = await User.findOne({
      where: {
        employeeId,
        ...(excludeUserId ? { id: { [Op.ne]: excludeUserId } } : {})
      },
      attributes: ['id']
    });

    if (existingEmployeeUser) {
      return { valid: false, message: 'Employee ID already exists' };
    }
  }

  return { valid: true };
};

const wouldCreateCycle = (childId, managerId, parentById) => {
  const seen = new Set([childId]);
  let current = managerId;

  while (current) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = parentById.get(current) || null;
  }

  return false;
};

const sortOrgNodes = (nodes) => {
  nodes.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  nodes.forEach((node) => sortOrgNodes(node.subordinates));
};

const buildOrgChart = (users) => {
  const nodesById = new Map();
  const parentById = new Map();
  const attached = new Set();

  users.forEach((user) => {
    nodesById.set(user.id, {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
      profilePhotoUrl: user.profilePhotoUrl,
      isActive: user.isActive,
      subordinates: []
    });
    parentById.set(user.id, user.reportsTo || null);
  });

  users.forEach((user) => {
    const managerId = parentById.get(user.id);
    if (!managerId || !nodesById.has(managerId)) return;
    if (managerId === user.id) return;
    if (wouldCreateCycle(user.id, managerId, parentById)) return;

    nodesById.get(managerId).subordinates.push(nodesById.get(user.id));
    attached.add(user.id);
  });

  const roots = users
    .filter((user) => !attached.has(user.id))
    .map((user) => nodesById.get(user.id));

  sortOrgNodes(roots);
  return roots;
};

// @desc    Create user with role (Admin only, OTP auth enforced)
// @route   POST /api/auth/admin/create-user
// @access  Private (BAC/CAE only)
router.post('/admin/create-user', protect, hasRoleLevel('bac_secretariat'), async (req, res) => {
  try {
    const { name, email, role, password, department, employeeId, reportsTo } = req.body;

    if (!name || !email || !role) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, and role'
      });
    }

    if (hasField(req.body, 'password')) {
      return res.status(400).json({
        success: false,
        message: 'Password is not allowed for admin create-user. This endpoint creates OTP-based users only.'
      });
    }

    if (typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Name must be at least 2 characters'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be one of: ' + VALID_ROLES.join(', ')
      });
    }

    if (!canAssignRole(req.user.role, role)) {
      return res.status(403).json({
        success: false,
        message: `You are not allowed to assign the ${role} role`
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedEmployeeId = normalizeNullable(employeeId);

    const uniqueCheck = await validateUniqueUserFields({
      email: normalizedEmail,
      employeeId: normalizedEmployeeId
    });

    if (!uniqueCheck.valid) {
      return res.status(400).json({
        success: false,
        message: uniqueCheck.message
      });
    }

    const reportsToValidation = await validateReportsTo(reportsTo);
    if (!reportsToValidation.valid) {
      return res.status(400).json({
        success: false,
        message: reportsToValidation.message
      });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      role,
      department: normalizeNullable(department),
      employeeId: normalizedEmployeeId,
      reportsTo: reportsToValidation.value !== undefined ? reportsToValidation.value : null,
      authMethod: 'email_otp',
      isEmailVerified: false,
      isActive: true,
      roleSelectedAt: new Date()
    });

    sendWelcomeEmail(user.email, user.name).catch(console.warn);

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: toSafeUser(user)
    });
  } catch (error) {
    console.error('Admin create user error:', error);

    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({
        success: false,
        message: 'Email or employee ID already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating user'
    });
  }
});

// @desc    Get all users (Admin only)
// @route   GET /api/auth/admin/users
// @access  Private (BAC/CAE only)
router.get('/admin/users', protect, hasRoleLevel('bac_secretariat'), async (req, res) => {
  try {
    const { role, department, isActive, search } = req.query;
    
    const where = {};
    if (role) {
      if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid role filter'
        });
      }
      where.role = role;
    }
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
      data: users.map(toSafeUser)
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
      data: pendingUsers.map(toSafeUser)
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

    if (!canAssignRole(req.user.role, role)) {
      return res.status(403).json({
        success: false,
        message: `You are not allowed to assign the ${role} role`
      });
    }

    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const reportsToValidation = await validateReportsTo(reportsTo, userId);
    if (!reportsToValidation.valid) {
      return res.status(400).json({
        success: false,
        message: reportsToValidation.message
      });
    }

    const normalizedEmployeeId = normalizeNullable(employeeId);
    const uniqueCheck = await validateUniqueUserFields({
      employeeId: normalizedEmployeeId,
      excludeUserId: userId
    });

    if (!uniqueCheck.valid) {
      return res.status(400).json({
        success: false,
        message: uniqueCheck.message
      });
    }

    const updates = {
      role,
      roleSelectedAt: new Date()
    };

    if (department !== undefined) updates.department = normalizeNullable(department);
    if (employeeId !== undefined) updates.employeeId = normalizedEmployeeId;
    if (reportsToValidation.value !== undefined) updates.reportsTo = reportsToValidation.value;

    await user.update({
      ...updates
    });

    res.json({
      success: true,
      message: `Role ${role} assigned to ${user.name}`,
      data: toSafeUser(user)
    });

  } catch (error) {
    console.error('Role assignment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error assigning role'
    });
  }
});

// @desc    Get user details (Admin only)
// @route   GET /api/auth/admin/users/:id
// @access  Private (BAC/CAE only)
router.get('/admin/users/:id', protect, hasRoleLevel('bac_secretariat'), async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id, {
      attributes: { exclude: ['password'] }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const manager = user.reportsTo
      ? await User.findByPk(user.reportsTo, {
          attributes: ['id', 'name', 'email', 'role', 'department', 'profilePhotoUrl', 'isActive']
        })
      : null;

    const subordinates = await User.findAll({
      where: { reportsTo: user.id },
      attributes: ['id', 'name', 'email', 'role', 'department', 'profilePhotoUrl', 'isActive'],
      order: [['name', 'ASC']]
    });

    res.json({
      success: true,
      data: {
        ...toSafeUser(user),
        manager: toSafeUser(manager),
        subordinates: subordinates.map(toSafeUser)
      }
    });
  } catch (error) {
    console.error('Get user details error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user details'
    });
  }
});

// @desc    Update user (Admin only)
// @route   PUT /api/auth/admin/users/:id
// @access  Private (BAC/CAE only)
router.put('/admin/users/:id', protect, hasRoleLevel('bac_secretariat'), async (req, res) => {
  try {
    const { id } = req.params;
    const allowedFields = ['name', 'email', 'role', 'department', 'employeeId', 'reportsTo', 'isActive'];
    const hasUpdates = allowedFields.some((field) => hasField(req.body, field));

    if (!hasUpdates) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields provided for update'
      });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const updates = {};

    if (hasField(req.body, 'name')) {
      if (typeof req.body.name !== 'string' || req.body.name.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Name must be at least 2 characters'
        });
      }
      updates.name = req.body.name.trim();
    }

    let normalizedEmail;
    if (hasField(req.body, 'email')) {
      if (!isValidEmail(req.body.email)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid email address'
        });
      }
      normalizedEmail = req.body.email.toLowerCase().trim();
      updates.email = normalizedEmail;
    }

    if (hasField(req.body, 'role')) {
      if (!VALID_ROLES.includes(req.body.role)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid role. Must be one of: ' + VALID_ROLES.join(', ')
        });
      }
      if (!canAssignRole(req.user.role, req.body.role)) {
        return res.status(403).json({
          success: false,
          message: `You are not allowed to assign the ${req.body.role} role`
        });
      }
      updates.role = req.body.role;
      if (req.body.role !== user.role) {
        updates.roleSelectedAt = new Date();
      }
    }

    const normalizedEmployeeId = hasField(req.body, 'employeeId')
      ? normalizeNullable(req.body.employeeId)
      : undefined;

    const uniqueCheck = await validateUniqueUserFields({
      email: normalizedEmail,
      employeeId: normalizedEmployeeId,
      excludeUserId: id
    });

    if (!uniqueCheck.valid) {
      return res.status(400).json({
        success: false,
        message: uniqueCheck.message
      });
    }

    if (hasField(req.body, 'department')) {
      updates.department = normalizeNullable(req.body.department);
    }

    if (hasField(req.body, 'employeeId')) {
      updates.employeeId = normalizedEmployeeId;
    }

    if (hasField(req.body, 'isActive')) {
      if (typeof req.body.isActive === 'boolean') {
        updates.isActive = req.body.isActive;
      } else if (req.body.isActive === 'true' || req.body.isActive === 'false') {
        updates.isActive = req.body.isActive === 'true';
      } else {
        return res.status(400).json({
          success: false,
          message: 'isActive must be a boolean'
        });
      }
    }

    const reportsToValidation = await validateReportsTo(req.body.reportsTo, id);
    if (!reportsToValidation.valid) {
      return res.status(400).json({
        success: false,
        message: reportsToValidation.message
      });
    }
    if (reportsToValidation.value !== undefined) {
      updates.reportsTo = reportsToValidation.value;
    }

    await user.update(updates);

    res.json({
      success: true,
      message: 'User updated successfully',
      data: toSafeUser(user)
    });
  } catch (error) {
    console.error('Update user error:', error);

    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({
        success: false,
        message: 'Email or employee ID already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error updating user'
    });
  }
});

// @desc    Deactivate user (Admin only)
// @route   DELETE /api/auth/admin/users/:id
// @access  Private (BAC/CAE only)
router.delete('/admin/users/:id', protect, hasRoleLevel('bac_secretariat'), async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.id === id) {
      return res.status(400).json({
        success: false,
        message: 'You cannot deactivate your own account'
      });
    }

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    await user.update({ isActive: false });

    res.json({
      success: true,
      message: 'User deactivated successfully',
      data: {
        id: user.id,
        isActive: user.isActive
      }
    });
  } catch (error) {
    console.error('Deactivate user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deactivating user'
    });
  }
});

// @desc    Get organization chart
// @route   GET /api/auth/admin/org-chart
// @access  Private (BAC/CAE only)
router.get('/admin/org-chart', protect, hasRoleLevel('bac_secretariat'), async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true';

    const users = await User.findAll({
      where: includeInactive ? {} : { isActive: true },
      attributes: ['id', 'name', 'email', 'role', 'department', 'profilePhotoUrl', 'isActive', 'reportsTo'],
      order: [['name', 'ASC']]
    });

    const orgChart = buildOrgChart(users);

    res.json({
      success: true,
      data: orgChart,
      meta: {
        includeInactive,
        totalUsers: users.length
      }
    });
  } catch (error) {
    console.error('Org chart error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching organization chart'
    });
  }
});

module.exports = router;

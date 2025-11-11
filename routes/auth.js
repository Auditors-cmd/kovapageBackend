const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { sendOTPEmail, sendWelcomeEmail, sendPasswordResetEmail } = require('../utils/emailService');
const { createOTP, verifyOTP } = require('../utils/otpService');
const { protect } = require('../middleware/auth');

// Initialize router - THIS LINE WAS MISSING!
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

// =======================
// PASSWORD AUTHENTICATION
// =======================

// @desc    Register new user with name/password
// @route   POST /api/auth/register
// @access  Public
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, and password'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      where: { 
        email: email.toLowerCase() 
      }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Create user
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase(),
      password,
      authMethod: 'password',
      role: 'auditor',
      isEmailVerified: false,
      isActive: true,
      lastLogin: new Date()
    });

    const token = generateToken(user.id);

    res.status(201).json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
          authMethod: user.authMethod,
          lastLogin: user.lastLogin
        },
        token
      },
      message: 'User registered successfully! Welcome to KovaPage!'
    });

  } catch (error) {
    console.error('Registration error:', error);
    
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

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    // Check for user with password
    const user = await User.findOne({
      where: { 
        email: email.toLowerCase(),
        authMethod: 'password',
        isActive: true
      }
    });
    
    if (user && (await user.matchPassword(password))) {
      // Update last login
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
            isEmailVerified: user.isEmailVerified,
            authMethod: user.authMethod,
            lastLogin: user.lastLogin
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
// PASSWORD RESET FLOW
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

    // Find user
    const user = await User.findOne({
      where: { 
        email: email.toLowerCase(),
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

    // Check if user uses password auth
    if (user.authMethod !== 'password') {
      return res.status(400).json({
        success: false,
        message: 'Please use OTP authentication for this account'
      });
    }

    // Generate reset OTP
    const resetOTP = createOTP(email);
    
    // Send reset email
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

    // Verify reset OTP
    const otpVerification = verifyOTP(email, otp);
    if (!otpVerification.isValid) {
      return res.status(400).json({
        success: false,
        message: otpVerification.message || 'Invalid or expired reset code'
      });
    }

    // Find user
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

    // Update password
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
router.post('/email/register', async (req, res) => {
  try {
    const { email, name } = req.body;

    // Validation
    if (!email || !name) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and name'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    if (name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Name must be at least 2 characters long'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      where: { email: email.toLowerCase() }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists'
      });
    }

    // Generate and send OTP
    const otp = createOTP(email);
    const emailResult = await sendOTPEmail(email, otp, name);

    if (!emailResult.success) {
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
        name: name.trim()
      }
    });

  } catch (error) {
    console.error('Email registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
});

// @desc    Verify OTP and complete registration
// @route   POST /api/auth/email/verify
// @access  Public
router.post('/email/verify', async (req, res) => {
  try {
    const { email, name, otp } = req.body;

    // Validation
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

    // Verify OTP
    const otpVerification = verifyOTP(email, otp);
    
    if (!otpVerification.isValid) {
      return res.status(400).json({
        success: false,
        message: otpVerification.message
      });
    }

    // Create user (no password for OTP-based auth)
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase(),
      isEmailVerified: true,
      authMethod: 'email_otp',
      role: 'auditor',
      isActive: true,
      lastLogin: new Date()
    });

    // Generate token
    const token = generateToken(user.id);

    // Send welcome email
    sendWelcomeEmail(email, name)
      .then(result => {
        if (!result.success) {
          console.warn('Welcome email failed:', result.error);
        }
      })
      .catch(error => {
        console.error('Welcome email error:', error);
      });

    res.status(201).json({
      success: true,
      message: 'Email verified successfully! Welcome to KovaPage!',
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
          authMethod: user.authMethod,
          lastLogin: user.lastLogin
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

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid email address'
      });
    }

    // Check if user exists
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

    // Generate and send OTP
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

    // Verify OTP
    const otpVerification = verifyOTP(email, otp);
    
    if (!otpVerification.isValid) {
      return res.status(400).json({
        success: false,
        message: otpVerification.message
      });
    }

    // Get user and update last login
    const user = await User.findOne({
      where: { email: email.toLowerCase() }
    });
    
    await user.update({ lastLogin: new Date() });

    // Generate token
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
          isEmailVerified: user.isEmailVerified,
          authMethod: user.authMethod,
          lastLogin: user.lastLogin
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
// COMMON ROUTES
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
      data: user
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
      data: user
    });
  } catch (error) {
    console.error('Status check error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking authentication status'
    });
  }
});

// Don't forget to export the router!
module.exports = router;
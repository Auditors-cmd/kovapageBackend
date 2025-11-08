const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendOTPEmail } = require('../utils/emailService');
const { createOTP, verifyOTP } = require('../utils/otpService');
const { protect } = require('../middleware/auth');
const router = express.Router();

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// Email validation function
const isValidEmail = (email) => {
  const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
  return emailRegex.test(email);
};



// @desc    Register new user with name/password
// @route   POST /api/auth/register...i assume the register
// @access  Public
router.post('/register', async (req, res) => {
  try {
    const { name, password } = req.body;

    // Validation
    if (!name || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both name and password'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    // Check if user already exists
    const userExists = await User.findOne({ 
      name: { $regex: new RegExp(`^${name}$`, 'i') } 
    });

    if (userExists) {
      return res.status(400).json({
        success: false,
        message: 'User with this name already exists'
      });
    }

    // Create user
    const user = await User.create({
      name: name.trim(),
      password,
      authMethod: 'password'
    });

    if (user) {
      // Updating last login
      user.lastLogin = new Date();
      await user.save();

      res.status(201).json({
        success: true,
        data: {
          _id: user._id,
          name: user.name,
          role: user.role,
          token: generateToken(user._id),
          lastLogin: user.lastLogin,
          authMethod: user.authMethod
        },
        message: 'User registered successfully! Welcome to KovaPage!'
      });
    }
  } catch (error) {
    console.error('Registration error:', error);
    
    // for handle duplicate key errors
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'User with this name already exists'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error during registration. Please try again.'
    });
  }
});

// @desc    Authenticate user & get token (Manual login)
// @route   POST /api/auth/login
// @access  Public
router.post('/login', async (req, res) => {
  try {
    const { name, password } = req.body;

    // Validation
    if (!name || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both name and password'
      });
    }

    // Check for user
    const user = await User.findOne({ 
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      isActive: true 
    });

    if (user && (await user.matchPassword(password))) {
      // Update last login
      user.lastLogin = new Date();
      await user.save();

      res.json({
        success: true,
        data: {
          _id: user._id,
          name: user.name,
          role: user.role,
          token: generateToken(user._id),
          lastLogin: user.lastLogin,
          authMethod: user.authMethod
        },
        message: `Welcome back, ${user.name}!`
      });
    } else {
      res.status(401).json({
        success: false,
        message: 'Invalid credentials. Please check your name and password.'
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

// @desc    Check if name is available
// @route   GET /api/auth/check-name/:name
// @access  Public
router.get('/check-name/:name', async (req, res) => {
  try {
    const { name } = req.params;

    if (!name || name.trim().length < 2) {
      return res.json({
        available: false,
        message: 'Name must be at least 2 characters long'
      });
    }

    const existingUser = await User.findOne({ 
      name: { $regex: new RegExp(`^${name}$`, 'i') } 
    });

    res.json({
      available: !existingUser,
      message: existingUser ? 'Name already taken' : 'Name available'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error checking name availability'
    });
  }
});


// EMAIL OTP AUTHENTICATION ROUTES 

// @desc    Start email registration (Send OTP to ANY email)
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

    // Validate email format
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

    // Check if user already exists by email
    const existingUser = await User.findOne({ 
      email: email.toLowerCase() 
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'An account with this email already exists'
      });
    }

    // Check if name is already taken
    const existingName = await User.findOne({ 
      name: { $regex: new RegExp(`^${name}$`, 'i') } 
    });

    if (existingName) {
      return res.status(400).json({
        success: false,
        message: 'This name is already taken. Please choose a different name.'
      });
    }

    // Generate and send OTP
    const otp = await createOTP(email);
    const emailResult = await sendOTPEmail(email, otp, name);

    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification email. Please try again.',
        details: emailResult.details
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
    const otpVerification = await verifyOTP(email, otp);
    
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
      authMethod: 'email_otp'
    });

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    res.status(201).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        token: generateToken(user._id),
        lastLogin: user.lastLogin,
        authMethod: user.authMethod
      },
      message: 'Email verified successfully! Welcome to KovaPage!'
    });

  } catch (error) {
    console.error('OTP verification error:', error);
    
    // Handle duplicate errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      const message = field === 'email' 
        ? 'An account with this email already exists' 
        : 'This name is already taken';
      
      return res.status(400).json({
        success: false,
        message: message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Server error during verification'
    });
  }
});

// @desc    Email login (Send OTP to ANY email)
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
      email: email.toLowerCase(),
      isActive: true 
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email. Please register first.'
      });
    }

    // Generate and send OTP
    const otp = await createOTP(email);
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
    const otpVerification = await verifyOTP(email, otp);
    
    if (!otpVerification.isValid) {
      return res.status(400).json({
        success: false,
        message: otpVerification.message
      });
    }

    // Get user and update last login
    const user = await User.findOne({ email: email.toLowerCase() });
    user.lastLogin = new Date();
    await user.save();

    res.json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isEmailVerified: user.isEmailVerified,
        token: generateToken(user._id),
        lastLogin: user.lastLogin,
        authMethod: user.authMethod
      },
      message: `Welcome back, ${user.name}!`
    });

  } catch (error) {
    console.error('Login OTP verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login verification'
    });
  }
});


// COMMON ROUTES (Work for both manual and email users)

// @desc    Get user profile
// @route   GET /api/auth/profile
// @access  Private
router.get('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    
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
    res.json({
      success: true,
      isAuthenticated: true,
      data: {
        _id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        lastLogin: req.user.lastLogin,
        authMethod: req.user.authMethod,
        isEmailVerified: req.user.isEmailVerified
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

module.exports = router;
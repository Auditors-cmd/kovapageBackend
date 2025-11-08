
//development has started bro!

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { sendOTPEmail, sendWelcomeEmail } = require('./utils/emailService');
const { createOTP, verifyOTP } = require('./utils/otpService');

const app = express();
const PORT = process.env.PORT || 5000;

// middleware for all this,
app.use(cors());
app.use(express.json());

// for request logging
app.use((req, res, next) => {
  console.log('📨', req.method, req.url, req.body);
  next();
});

// best to check if server works fine
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK',
    message: 'Server with REAL email OTP is running!',
    email_service: 'Active',
    timestamp: new Date().toISOString()
  });
});

// OTP Registration, this is with nodemailer, i hope it works fine...
app.post('/api/auth/email/register', async (req, res) => {
  try {
    const { email, name } = req.body;
    
    console.log('📧 REAL OTP request for:', email);

    if (!email || !name) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and name'
      });
    }

    // Generate OTP, function
    const otp = createOTP(email);
    
    // Send email
    const emailResult = await sendOTPEmail(email, otp, name);
//will throw an error if a fake email is sent.
    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification email. Please try again.',
        error: emailResult.error
      });
    }

    res.json({
      success: true,
      message: `✅ Verification code sent to ${email}`,
      data: {
        email: email,
        name: name
      }
    });

  } catch (error) {
    console.error('💥 OTP Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
});

// OTP Verification with Welcome Email, must welcome the user ...this is demo,please take note delight.
app.post('/api/auth/email/verify', async (req, res) => {
  try {
    const { email, name, otp } = req.body;
    
    console.log(' OTP verification for:', email);

    if (!email || !name || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email, name, and OTP'
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

    // OTP is valid - Send welcome email
    console.log(' OTP verified successfully! Sending welcome email...');
    
    const welcomeEmailResult = await sendWelcomeEmail(email, name);
    
    if (!welcomeEmailResult.success) {
      console.warn('Welcome email failed, but OTP verification was successful....hopefully, haha!');
      // Continue anyway since OTP verification was successful
    }

    // Success response
    res.json({
      success: true,
      data: {
        name: name,
        email: email,
        token: 'jwt_token_' + Date.now(),
        isEmailVerified: true,
        welcomeEmailSent: welcomeEmailResult.success,
        message: ' Email verified successfully! Welcome to KovaPage!'
      }
    });

  } catch (error) {
    console.error('💥 OTP Verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during verification'
    });
  }
});

// 404 handler, i was advised to create this =
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

app.listen(PORT, () => {
  console.log('========================================');
  console.log('KOVAPAGE WITH WELCOME EMAILS');
  console.log('========================================');
  console.log(` Port: ${PORT}`);
  console.log(`Email: ${process.env.EMAIL_USER}`);
  console.log(' Features: OTP + Welcome emails');
  console.log('========================================');
});
const nodemailer = require('nodemailer');

// Create transporter with Gmail credentials
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

// Verify email configuration
console.log('Configuring real email service...');
console.log('Email:', process.env.EMAIL_USER);

transporter.verify((error, success) => {
  if (error) {
    console.log('Email configuration error:', error.message);
  } else {
    console.log('✅ REAL email server is ready!');
  }
});

const sendOTPEmail = async (email, otp, userName = 'User') => {
  try {
    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Your KovaPage Verification Code',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white; }
                .content { padding: 40px; }
                .otp-code { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; text-align: center; border-radius: 10px; margin: 25px 0; font-size: 32px; font-weight: bold; letter-spacing: 8px; }
                .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 12px; }
                .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>KovaPage</h1>
                    <p>Audit App Verification</p>
                </div>
                <div class="content">
                    <h2>Hello ${userName},</h2>
                    <p>Thank you for registering with KovaPage Audit App. Use the verification code below to complete your registration:</p>
                    
                    <div class="otp-code">${otp}</div>
                    
                    <div class="warning">
                        <strong> Important Security Notice:</strong><br>
                        This code will expire in 10 minutes. Do not share this code with anyone.
                    </div>
                    
                    <p>If you didn't request this code, please ignore this email.</p>
                </div>
                <div class="footer">
                    <p>&copy; 2024 KovaPage Audit App. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`REAL OTP email sent to ${email}`);
    console.log(`Message ID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(` Failed to send OTP to ${email}:`, error.message);
    return { 
      success: false, 
      error: error.message
    };
  }
};

// Sends welcome email after successful verification
const sendWelcomeEmail = async (email, userName = 'User') => {
  try {
    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Welcome to KovaPage - Email Verified Successfully! 🎉',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Arial', sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); margin: 0; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 15px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; text-align: center; color: white; }
                .content { padding: 50px 40px; text-align: center; }
                .welcome-icon { font-size: 80px; margin-bottom: 20px; }
                .welcome-text { font-size: 28px; color: #333; margin-bottom: 20px; font-weight: bold; }
                .success-message { background: #d4edda; color: #155724; padding: 20px; border-radius: 10px; margin: 25px 0; border: 2px solid #c3e6cb; }
                .features { text-align: left; margin: 30px 0; }
                .feature-item { margin: 15px 0; padding-left: 25px; position: relative; }
                .feature-item:before { content: "✓"; color: #28a745; font-weight: bold; position: absolute; left: 0; }
                .cta-button { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; display: inline-block; margin: 20px 0; font-weight: bold; }
                .footer { background: #f8f9fa; padding: 25px; text-align: center; color: #666; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1 style="margin: 0; font-size: 36px;">KovaPage</h1>
                    <p style="margin: 10px 0 0 0; opacity: 0.9; font-size: 18px;">Audit App</p>
                </div>
                <div class="content">
                
                    <div class="welcome-text">Welcome to KovaPage, ${userName}!</div>
                    
                    <div class="success-message">
                        <strong>Email Verified Successfully!</strong><br>
                        Your email address has been verified and your account is now active.
                    </div>
                    
                    <p style="color: #666; line-height: 1.6; font-size: 16px;">
                        Thank you for joining KovaPage Audit App. You're now ready to start managing your audits efficiently and securely.
                    </p>
                    
                    <div class="features">
                        <div class="feature-item">Secure audit management and tracking</div>
                        <div class="feature-item">Real-time collaboration with your team</div>
                        <div class="feature-item">Advanced reporting and analytics</div>
                        <div class="feature-item">Bank-level security for your data</div>
                    </div>
                    
                    <a href="#" class="cta-button">Get Started with KovaPage</a>
                    
                    <p style="color: #888; font-size: 14px; margin-top: 30px;">
                        Need help? Contact our support team at support@kovapage.com
                    </p>
                </div>
                <div class="footer">
                    <p style="margin: 0;">&copy; 2024 KovaPage Audit App. All rights reserved.</p>
                    <p style="margin: 5px 0 0 0; font-size: 12px; color: #999;">
                        Securing your audit processes with cutting-edge technology
                    </p>
                </div>
            </div>
        </body>
        </html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(` Welcome email sent to ${email}`);
    console.log(`Welcome Message ID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(` Failed to send welcome email to ${email}:`, error.message);
    return { 
      success: false, 
      error: error.message
    };
  }
};

// Password reset email function
const sendPasswordResetEmail = async (email, resetToken, userName = 'User') => {
  try {
    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Reset Your KovaPage Password',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
                .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white; }
                .content { padding: 40px; }
                .reset-code { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; text-align: center; border-radius: 10px; margin: 25px 0; font-size: 32px; font-weight: bold; letter-spacing: 8px; }
                .footer { background: #f8f9fa; padding: 20px; text-align: center; color: #666; font-size: 12px; }
                .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0; }
                .button { background: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>KovaPage</h1>
                    <p>Password Reset Request</p>
                </div>
                <div class="content">
                    <h2>Hello ${userName},</h2>
                    <p>We received a request to reset your password for your KovaPage account. Use the reset code below:</p>
                    
                    <div class="reset-code">${resetToken}</div>
                    
                    <div class="warning">
                        <strong>Important Security Notice:</strong><br>
                        This reset code will expire in 10 minutes. Do not share this code with anyone.
                    </div>
                    
                    <p>If you didn't request a password reset, please ignore this email and your password will remain unchanged.</p>
                    
                    <p>Need help? Contact our support team at support@kovapage.com</p>
                </div>
                <div class="footer">
                    <p>&copy; 2026 KovaPage Audit App. All rights reserved, hopefully.</p>
                </div>
            </div>
        </body>
        </html>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`🔐 Password reset email sent to ${email}`);
    console.log(`Reset Message ID: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error(` Failed to send password reset email to ${email}:`, error.message);
    return { 
      success: false, 
      error: error.message
    };
  }
};

// Make sure ALL functions are exported
module.exports = {
  sendOTPEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail
};

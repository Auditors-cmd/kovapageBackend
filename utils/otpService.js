const otpGenerator = require('otp-generator');

// Store OTPs in memory (in production, we shall use Redis for this.
const otpStore = new Map();

const generateOTP = () => {
  return otpGenerator.generate(6, {
    digits: true,
    lowerCaseAlphabets: false,
    upperCaseAlphabets: false,
    specialChars: false
  });
};

const createOTP = (email) => {
  // Clear any existing OTP for this email
  otpStore.delete(email);
  
  const otp = generateOTP();
  const expiresAt = Date.now() + (10 * 60 * 1000); // for 10 mins.
  
  otpStore.set(email, {
    otp,
    expiresAt,
    attempts: 0
  });
  
  console.log(`📧 REAL OTP for ${email}: ${otp} (expires: ${new Date(expiresAt).toLocaleTimeString()})`);
  return otp;
};

const verifyOTP = (email, otp) => {
  const otpData = otpStore.get(email);
  
  if (!otpData) {
    return { isValid: false, message: 'OTP not found or expired' };
  }
  
  if (Date.now() > otpData.expiresAt) {
    otpStore.delete(email);
    return { isValid: false, message: 'OTP has expired. Please request a new one.' };
  }
  
  if (otpData.otp !== otp) {
    otpData.attempts += 1;
    
    if (otpData.attempts >= 3) {
      otpStore.delete(email);
      return { isValid: false, message: 'Too many failed attempts. Please request a new OTP.' };
    }
    
    return { isValid: false, message: 'Invalid OTP' };
  }
  
  
  otpStore.delete(email);
  return { isValid: true, message: 'OTP verified successfully' };
};

module.exports = { createOTP, verifyOTP };

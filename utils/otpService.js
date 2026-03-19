const otpGenerator = require('otp-generator');
const OTP = require('../models/OTP');
const User = require('../models/User');

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 10);
const MAX_OTP_ATTEMPTS = 3;
const ephemeralOtpStore = new Map();

const normalizeEmail = (email) => String(email || '').toLowerCase().trim();

const generateOTP = () => {
  const generated = otpGenerator.generate(6, {
    digits: true,
    lowerCaseAlphabets: false,
    upperCaseAlphabets: false,
    specialChars: false
  });

  const digitsOnly = String(generated).replace(/\D/g, '');
  if (digitsOnly.length >= 6) return digitsOnly.slice(0, 6);

  let padded = digitsOnly;
  while (padded.length < 6) {
    padded += Math.floor(Math.random() * 10);
  }
  return padded;
};

const createOTP = async (email) => {
  const normalizedEmail = normalizeEmail(email);
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
  ephemeralOtpStore.delete(normalizedEmail);
  const existingUser = await User.findOne({
    where: { email: normalizedEmail },
    attributes: ['id']
  });

  // New users may not satisfy FK constraints on otps.email -> users.email.
  // Keep temporary registration OTPs in-memory while account doesn't yet exist.
  if (!existingUser) {
    ephemeralOtpStore.set(normalizedEmail, {
      otp,
      expiresAt: expiresAt.getTime(),
      attempts: 0
    });
    return otp;
  }

  await OTP.destroy({
    where: {
      email: normalizedEmail
    }
  });

  await OTP.create({
    email: normalizedEmail,
    otp,
    expiresAt,
    isUsed: false,
    attemptCount: 0
  });

  return otp;
};

const verifyOTP = async (email, otp) => {
  const normalizedEmail = normalizeEmail(email);
  const normalizedOtp = String(otp || '').trim();
  const inMemoryOtp = ephemeralOtpStore.get(normalizedEmail);

  if (inMemoryOtp) {
    if (Date.now() > inMemoryOtp.expiresAt) {
      ephemeralOtpStore.delete(normalizedEmail);
      return { isValid: false, message: 'OTP has expired. Please request a new OTP.' };
    }

    if (inMemoryOtp.otp !== normalizedOtp) {
      inMemoryOtp.attempts += 1;
      if (inMemoryOtp.attempts >= MAX_OTP_ATTEMPTS) {
        ephemeralOtpStore.delete(normalizedEmail);
        return { isValid: false, message: 'Too many failed attempts. Please request a new OTP.' };
      }
      return { isValid: false, message: 'Invalid OTP' };
    }

    ephemeralOtpStore.delete(normalizedEmail);
    return { isValid: true, message: 'OTP verified successfully' };
  }

  const otpData = await OTP.findOne({
    where: {
      email: normalizedEmail,
      isUsed: false
    },
    order: [['createdAt', 'DESC']]
  });

  if (!otpData) {
    return { isValid: false, message: 'OTP not found or expired' };
  }

  if (Date.now() > new Date(otpData.expiresAt).getTime()) {
    await otpData.destroy();
    return { isValid: false, message: 'OTP has expired. Please request a new OTP.' };
  }

  if (otpData.otp !== normalizedOtp) {
    const attempts = (otpData.attemptCount || 0) + 1;

    if (attempts >= MAX_OTP_ATTEMPTS) {
      await otpData.destroy();
      return { isValid: false, message: 'Too many failed attempts. Please request a new OTP.' };
    }

    await otpData.update({ attemptCount: attempts });
    return { isValid: false, message: 'Invalid OTP' };
  }

  await otpData.update({ isUsed: true });
  return { isValid: true, message: 'OTP verified successfully' };
};

module.exports = { createOTP, verifyOTP };

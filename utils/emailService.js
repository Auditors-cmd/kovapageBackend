const nodemailer = require('nodemailer');

const resolveBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
};

const resolveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const resolveEmailPassword = () => String(process.env.EMAIL_PASSWORD || '').replace(/\s+/g, '').trim();
const resolveEmailPort = () => resolveNumber(process.env.EMAIL_PORT || 587, 587);

const resolvedEmailPassword = resolveEmailPassword();
const resolvedEmailPort = resolveEmailPort();
const resolvedEmailSecure =
  process.env.EMAIL_SECURE === undefined
    ? resolvedEmailPort === 465
    : resolveBoolean(process.env.EMAIL_SECURE, false);

const emailProvider = String(
  process.env.EMAIL_PROVIDER || (process.env.RESEND_API_KEY ? 'resend' : 'smtp')
).trim().toLowerCase();

const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
const resendApiUrl = process.env.RESEND_API_URL || 'https://api.resend.com/emails';
const resendTimeoutMs = resolveNumber(process.env.RESEND_TIMEOUT_MS || 20000, 20000);
const defaultResendFrom = process.env.RESEND_FROM || 'KovaPage <onboarding@resend.dev>';

const resolveFromAddress = () => {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;

  // For Resend, do not default to EMAIL_USER (often a Gmail address that Resend rejects).
  if (emailProvider === 'resend' || (emailProvider === 'auto' && resendApiKey)) {
    return defaultResendFrom;
  }

  if (process.env.EMAIL_FROM_NAME && process.env.EMAIL_USER) {
    return `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_USER}>`;
  }

  return process.env.EMAIL_USER || 'KovaPage <no-reply@kovapage.com>';
};

const resolvedFromAddress = resolveFromAddress();

const transporterConfig = {
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: resolvedEmailPort,
  secure: resolvedEmailSecure,
  requireTLS: resolveBoolean(process.env.EMAIL_REQUIRE_TLS, !resolvedEmailSecure),
  connectionTimeout: resolveNumber(process.env.EMAIL_CONNECTION_TIMEOUT || 20000, 20000),
  greetingTimeout: resolveNumber(process.env.EMAIL_GREETING_TIMEOUT || 15000, 15000),
  socketTimeout: resolveNumber(process.env.EMAIL_SOCKET_TIMEOUT || 30000, 30000),
  family: 4,
  auth: {
    user: process.env.EMAIL_USER,
    pass: resolvedEmailPassword
  }
};

const hasSmtpCredentials = Boolean(process.env.EMAIL_USER && resolvedEmailPassword);
const transporter = hasSmtpCredentials ? nodemailer.createTransport(transporterConfig) : null;

const normalizeRecipients = (to) => (Array.isArray(to) ? to : [to]).filter(Boolean);

const formatProviderError = (payload) => {
  if (!payload) return 'Unknown provider response';
  if (typeof payload === 'string') return payload;
  if (payload.message) return payload.message;
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    return payload.errors.map((entry) => entry.message || String(entry)).join('; ');
  }
  return JSON.stringify(payload);
};

const sendViaResend = async (mailOptions) => {
  if (!resendApiKey) {
    return { success: false, error: 'RESEND_API_KEY is not configured' };
  }

  if (typeof fetch !== 'function') {
    return { success: false, error: 'Global fetch is unavailable in this Node runtime' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), resendTimeoutMs);

  try {
    const response = await fetch(resendApiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: mailOptions.from || resolvedFromAddress,
        to: normalizeRecipients(mailOptions.to),
        subject: mailOptions.subject,
        html: mailOptions.html
      }),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        success: false,
        error: `Resend request failed (${response.status}): ${formatProviderError(payload)}`
      };
    }

    return {
      success: true,
      messageId: payload?.id || payload?.data?.id || null
    };
  } catch (error) {
    return {
      success: false,
      error: error.name === 'AbortError'
        ? `Resend request timed out after ${resendTimeoutMs}ms`
        : error.message
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

const sendViaSmtp = async (mailOptions) => {
  if (!transporter) {
    return {
      success: false,
      error: 'SMTP is not configured. Set EMAIL_USER and EMAIL_PASSWORD.'
    };
  }

  try {
    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

const sendMail = async (mailOptions) => {
  if (emailProvider === 'resend') {
    return sendViaResend(mailOptions);
  }

  if (emailProvider === 'smtp') {
    return sendViaSmtp(mailOptions);
  }

  if (emailProvider === 'auto') {
    if (resendApiKey) {
      const resendResult = await sendViaResend(mailOptions);
      if (resendResult.success) return resendResult;
      console.warn('Resend failed in auto mode, falling back to SMTP:', resendResult.error);
    }
    return sendViaSmtp(mailOptions);
  }

  console.warn(`Unknown EMAIL_PROVIDER "${emailProvider}". Falling back to SMTP.`);
  return sendViaSmtp(mailOptions);
};

const wrapEmail = (title, body) => `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8" />
    <title>${title}</title>
  </head>
  <body style="font-family: Arial, sans-serif; background:#f5f5f5; margin:0; padding:24px; color:#111827;">
    <div style="max-width:620px; margin:0 auto; background:#ffffff; border-radius:10px; border:1px solid #e5e7eb; overflow:hidden;">
      <div style="background:#1d4ed8; color:#ffffff; padding:20px 24px;">
        <h1 style="margin:0; font-size:22px;">KovaPage</h1>
      </div>
      <div style="padding:24px; line-height:1.6;">
        ${body}
      </div>
    </div>
  </body>
  </html>
`;

console.log('Configuring email service...');
console.log('Email provider:', emailProvider);
console.log('Email sender:', resolvedFromAddress);

if (transporter) {
  console.log('SMTP transport:', {
    host: transporterConfig.host,
    port: transporterConfig.port,
    secure: transporterConfig.secure,
    requireTLS: transporterConfig.requireTLS,
    connectionTimeout: transporterConfig.connectionTimeout,
    greetingTimeout: transporterConfig.greetingTimeout,
    socketTimeout: transporterConfig.socketTimeout,
    hasPassword: Boolean(resolvedEmailPassword)
  });
}

if (emailProvider === 'smtp' || emailProvider === 'auto') {
  if (transporter) {
    transporter.verify((error) => {
      if (error) {
        console.log('Email configuration error:', error.message);
      } else {
        console.log('SMTP server is ready');
      }
    });
  } else {
    console.log('SMTP verify skipped: credentials are not configured.');
  }
}

const sendOTPEmail = async (email, otp, userName = 'User') => {
  try {
    const mailOptions = {
      from: resolvedFromAddress,
      to: email,
      subject: 'Your KovaPage Verification Code',
      html: wrapEmail(
        'KovaPage Verification Code',
        `
          <h2 style="margin-top:0;">Hello ${userName},</h2>
          <p>Use this one-time verification code to continue:</p>
          <div style="font-size:32px; letter-spacing:6px; font-weight:bold; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; padding:14px 16px; border-radius:8px; display:inline-block;">${otp}</div>
          <p style="margin-top:20px;">This code expires in 10 minutes. Do not share it with anyone.</p>
        `
      )
    };

    const result = await sendMail(mailOptions);
    if (!result.success) {
      console.error(`Failed to send OTP to ${email}:`, result.error);
      return { success: false, error: result.error };
    }

    console.log(`OTP email sent to ${email}`);
    console.log(`Message ID: ${result.messageId}`);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error(`Failed to send OTP to ${email}:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
};

const sendWelcomeEmail = async (email, userName = 'User') => {
  try {
    const mailOptions = {
      from: resolvedFromAddress,
      to: email,
      subject: 'Welcome to KovaPage',
      html: wrapEmail(
        'Welcome to KovaPage',
        `
          <h2 style="margin-top:0;">Welcome, ${userName}.</h2>
          <p>Your email address has been verified and your account is active.</p>
          <p>You can now start using KovaPage Audit App.</p>
        `
      )
    };

    const result = await sendMail(mailOptions);
    if (!result.success) {
      console.error(`Failed to send welcome email to ${email}:`, result.error);
      return { success: false, error: result.error };
    }

    console.log(`Welcome email sent to ${email}`);
    console.log(`Welcome Message ID: ${result.messageId}`);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error(`Failed to send welcome email to ${email}:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
};

const sendPasswordResetEmail = async (email, resetToken, userName = 'User') => {
  try {
    const mailOptions = {
      from: resolvedFromAddress,
      to: email,
      subject: 'Reset Your KovaPage Password',
      html: wrapEmail(
        'Reset Your Password',
        `
          <h2 style="margin-top:0;">Hello ${userName},</h2>
          <p>Use this code to reset your password:</p>
          <div style="font-size:32px; letter-spacing:6px; font-weight:bold; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; padding:14px 16px; border-radius:8px; display:inline-block;">${resetToken}</div>
          <p style="margin-top:20px;">This code expires in 10 minutes. If you did not request this, you can ignore this email.</p>
        `
      )
    };

    const result = await sendMail(mailOptions);
    if (!result.success) {
      console.error(`Failed to send password reset email to ${email}:`, result.error);
      return { success: false, error: result.error };
    }

    console.log(`Password reset email sent to ${email}`);
    console.log(`Reset Message ID: ${result.messageId}`);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error(`Failed to send password reset email to ${email}:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  sendOTPEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail
};

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

const sendgridApiKey = String(process.env.SENDGRID_API_KEY || '').trim();
const sendgridApiUrl = process.env.SENDGRID_API_URL || 'https://api.sendgrid.com/v3/mail/send';
const sendgridTimeoutMs = resolveNumber(process.env.SENDGRID_TIMEOUT_MS || 20000, 20000);
const defaultSendgridFrom = process.env.SENDGRID_FROM || process.env.EMAIL_FROM || 'KovaPage <no-reply@kovapage.com>';

const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
const resendApiUrl = process.env.RESEND_API_URL || 'https://api.resend.com/emails';
const resendTimeoutMs = resolveNumber(process.env.RESEND_TIMEOUT_MS || 20000, 20000);
const defaultResendFrom = process.env.RESEND_FROM || 'KovaPage <onboarding@resend.dev>';

const emailProvider = String(
  process.env.EMAIL_PROVIDER || (sendgridApiKey ? 'sendgrid' : resendApiKey ? 'resend' : 'smtp')
).trim().toLowerCase();

const normalizeRecipients = (to) => {
  if (Array.isArray(to)) return to.filter(Boolean);
  if (!to) return [];
  return String(to)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const parseAddress = (value) => {
  if (!value) return null;

  if (typeof value === 'object' && value.email) {
    return {
      email: String(value.email).trim(),
      name: value.name ? String(value.name).trim() : undefined
    };
  }

  const raw = String(value).trim();
  const match = raw.match(/^(?:"?([^"]+)"?\s*)?<([^>]+)>$/);
  if (match) {
    return {
      email: match[2].trim(),
      name: match[1] ? match[1].trim() : undefined
    };
  }

  return { email: raw };
};

const mapRecipientsForProvider = (value) => normalizeRecipients(value)
  .map(parseAddress)
  .filter((entry) => entry && entry.email);

const stripHtml = (html) => String(html || '')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/\s+/g, ' ')
  .trim();

const resolveFromAddress = () => {
  if (emailProvider === 'sendgrid') {
    return process.env.SENDGRID_FROM || process.env.EMAIL_FROM || defaultSendgridFrom;
  }

  if (emailProvider === 'resend') {
    return process.env.RESEND_FROM || process.env.EMAIL_FROM || defaultResendFrom;
  }

  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;

  if (emailProvider === 'auto' && sendgridApiKey && process.env.SENDGRID_FROM) {
    return process.env.SENDGRID_FROM;
  }

  if (emailProvider === 'auto' && resendApiKey && process.env.RESEND_FROM) {
    return process.env.RESEND_FROM;
  }

  if (process.env.EMAIL_FROM_NAME && process.env.EMAIL_USER) {
    return '"' + process.env.EMAIL_FROM_NAME + '" <' + process.env.EMAIL_USER + '>';
  }

  if (emailProvider === 'auto' && sendgridApiKey) {
    return defaultSendgridFrom;
  }

  if (emailProvider === 'auto' && resendApiKey) {
    return defaultResendFrom;
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
const smtpTransporter = hasSmtpCredentials ? nodemailer.createTransport(transporterConfig) : null;

const formatProviderError = (payload) => {
  if (!payload) return 'Unknown provider response';
  if (typeof payload === 'string') return payload;
  if (payload.message) return payload.message;
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    return payload.errors.map((entry) => entry.message || String(entry)).join('; ');
  }
  return JSON.stringify(payload);
};

const buildSendGridPayload = (mailOptions) => {
  const to = mapRecipientsForProvider(mailOptions.to);
  const from = parseAddress(mailOptions.from || resolvedFromAddress);

  if (to.length === 0) {
    throw new Error('At least one recipient is required');
  }

  if (!from || !from.email) {
    throw new Error('A valid from address is required for SendGrid');
  }

  const htmlBody = mailOptions.html ? String(mailOptions.html) : null;
  const textBody = mailOptions.text ? String(mailOptions.text) : (htmlBody ? stripHtml(htmlBody) : null);
  const content = [];

  if (textBody) {
    content.push({ type: 'text/plain', value: textBody });
  }

  if (htmlBody) {
    content.push({ type: 'text/html', value: htmlBody });
  }

  if (content.length === 0) {
    throw new Error('Email content is required');
  }

  const payload = {
    personalizations: [{
      to,
      ...(mailOptions.cc ? { cc: mapRecipientsForProvider(mailOptions.cc) } : {}),
      ...(mailOptions.bcc ? { bcc: mapRecipientsForProvider(mailOptions.bcc) } : {})
    }],
    from,
    subject: mailOptions.subject,
    content
  };

  const replyTo = parseAddress(mailOptions.replyTo);
  if (replyTo && replyTo.email) {
    payload.reply_to = replyTo;
  }

  return payload;
};

const createSendGridTransport = () => ({
  name: 'sendgrid-api',
  version: '1.0.0',
  send(mail, callback) {
    (async () => {
      if (!sendgridApiKey) {
        throw new Error('SENDGRID_API_KEY is not configured');
      }

      if (typeof fetch !== 'function') {
        throw new Error('Global fetch is unavailable in this Node runtime');
      }

      const payload = buildSendGridPayload(mail.data || {});
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), sendgridTimeoutMs);

      try {
        const response = await fetch(sendgridApiUrl, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + sendgridApiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        const rawBody = await response.text().catch(() => '');
        let parsedBody = null;
        if (rawBody) {
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {
            parsedBody = rawBody;
          }
        }

        if (!response.ok) {
          throw new Error('SendGrid request failed (' + response.status + '): ' + formatProviderError(parsedBody));
        }

        const envelope = mail.message && typeof mail.message.getEnvelope === 'function'
          ? mail.message.getEnvelope()
          : { from: payload.from.email, to: payload.personalizations[0].to.map((entry) => entry.email) };

        callback(null, {
          envelope,
          messageId: response.headers.get('x-message-id') || null,
          response: '202 Accepted'
        });
      } catch (error) {
        callback(error.name === 'AbortError'
          ? new Error('SendGrid request timed out after ' + sendgridTimeoutMs + 'ms')
          : error);
      } finally {
        clearTimeout(timeoutId);
      }
    })().catch(callback);
  }
});

const sendgridTransporter = sendgridApiKey
  ? nodemailer.createTransport(createSendGridTransport())
  : null;

const sendViaSendGrid = async (mailOptions) => {
  if (!sendgridTransporter) {
    return { success: false, error: 'SendGrid transport is not configured. Set SENDGRID_API_KEY.' };
  }

  try {
    const info = await sendgridTransporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId || null };
  } catch (error) {
    return { success: false, error: error.message };
  }
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
        Authorization: 'Bearer ' + resendApiKey,
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
        error: 'Resend request failed (' + response.status + '): ' + formatProviderError(payload)
      };
    }

    return {
      success: true,
      messageId: payload && (payload.id || (payload.data && payload.data.id)) || null
    };
  } catch (error) {
    return {
      success: false,
      error: error.name === 'AbortError'
        ? 'Resend request timed out after ' + resendTimeoutMs + 'ms'
        : error.message
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

const sendViaSmtp = async (mailOptions) => {
  if (!smtpTransporter) {
    return {
      success: false,
      error: 'SMTP is not configured. Set EMAIL_USER and EMAIL_PASSWORD.'
    };
  }

  try {
    const info = await smtpTransporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

const sendMail = async (mailOptions) => {
  if (emailProvider === 'sendgrid') {
    return sendViaSendGrid(mailOptions);
  }

  if (emailProvider === 'resend') {
    return sendViaResend(mailOptions);
  }

  if (emailProvider === 'smtp') {
    return sendViaSmtp(mailOptions);
  }

  if (emailProvider === 'auto') {
    if (sendgridApiKey) {
      const sendgridResult = await sendViaSendGrid(mailOptions);
      if (sendgridResult.success) return sendgridResult;
      console.warn('SendGrid failed in auto mode, trying next provider:', sendgridResult.error);
    }

    if (resendApiKey) {
      const resendResult = await sendViaResend(mailOptions);
      if (resendResult.success) return resendResult;
      console.warn('Resend failed in auto mode, trying SMTP:', resendResult.error);
    }

    return sendViaSmtp(mailOptions);
  }

  console.warn('Unknown EMAIL_PROVIDER "' + emailProvider + '". Falling back to SMTP.');
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
console.log('SendGrid transport:', {
  configured: Boolean(sendgridTransporter),
  apiUrl: sendgridApiUrl,
  timeoutMs: sendgridTimeoutMs
});
console.log('Resend transport:', {
  configured: Boolean(resendApiKey),
  apiUrl: resendApiUrl,
  timeoutMs: resendTimeoutMs
});

if (smtpTransporter) {
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
  if (smtpTransporter) {
    smtpTransporter.verify((error) => {
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
      console.error('Failed to send OTP to ' + email + ':', result.error);
      return { success: false, error: result.error };
    }

    console.log('OTP email sent to ' + email);
    console.log('Message ID: ' + result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Failed to send OTP to ' + email + ':', error.message);
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
      console.error('Failed to send welcome email to ' + email + ':', result.error);
      return { success: false, error: result.error };
    }

    console.log('Welcome email sent to ' + email);
    console.log('Welcome Message ID: ' + result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Failed to send welcome email to ' + email + ':', error.message);
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
      console.error('Failed to send password reset email to ' + email + ':', result.error);
      return { success: false, error: result.error };
    }

    console.log('Password reset email sent to ' + email);
    console.log('Reset Message ID: ' + result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error('Failed to send password reset email to ' + email + ':', error.message);
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
const nodemailer = require('nodemailer');

// App URL for notification links
const APP_URL = process.env.APP_URL || 'https://bellamare-tasks-fmf8dceyf2dgfban.canadacentral-01.azurewebsites.net';

// Carrier email-to-SMS gateways
const CARRIER_GATEWAYS = {
  verizon: 'vtext.com',
  att: 'txt.att.net',
  tmobile: 'tmomail.net',
  sprint: 'messaging.sprintpcs.com',
  uscellular: 'email.uscc.net',
  metro: 'mymetropcs.com',
  boost: 'sms.myboostmobile.com',
  cricket: 'sms.cricketwireless.net',
  googlefi: 'msg.fi.google.com',
  visible: 'vtext.com'
};

// Create transporter (lazy init)
let transporter = null;

function getTransporter() {
  if (!transporter) {
    const isGmail = (process.env.SMTP_HOST || '').includes('gmail');
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      ...(isGmail ? {} : { tls: { ciphers: 'SSLv3' } })
    });
  }
  return transporter;
}

// Send email
async function sendEmail(to, subject, text) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || process.env.SMTP_PASS === 'your-email-password-here') {
    console.log(`[EMAIL SKIPPED - SMTP not configured] To: ${to} Subject: ${subject}`);
    return false;
  }
  try {
    await getTransporter().sendMail({
      from: `"Bellamare Tasks" <${process.env.SMTP_USER}>`,
      to,
      subject: `[Bellamare Tasks] ${subject}`,
      text
    });
    console.log(`[EMAIL SENT] To: ${to} Subject: ${subject}`);
    return true;
  } catch (err) {
    console.error(`[EMAIL ERROR] To: ${to}`, err.message);
    return false;
  }
}

// Send SMS via email-to-SMS gateway
async function sendSMS(phone, carrier, message) {
  if (!phone || !carrier) return false;

  const gateway = CARRIER_GATEWAYS[carrier.toLowerCase()];
  if (!gateway) {
    console.log(`[SMS SKIPPED] Unknown carrier: ${carrier}`);
    return false;
  }

  // Strip non-digits from phone
  const cleanPhone = phone.replace(/\D/g, '');
  const smsEmail = `${cleanPhone}@${gateway}`;

  // Send directly without subject prefix (carrier gateways work better this way)
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || process.env.SMTP_PASS === 'your-email-password-here') {
    console.log(`[SMS SKIPPED - SMTP not configured] To: ${smsEmail}`);
    return false;
  }
  try {
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: smsEmail,
      subject: '',
      text: message
    });
    console.log(`[SMS SENT] To: ${smsEmail} (${phone} on ${carrier})`);
    return true;
  } catch (err) {
    console.error(`[SMS ERROR] To: ${smsEmail}`, err.message);
    return false;
  }
}

// Send both email and SMS to an employee
async function sendNotification(employee, subject, message) {
  const results = { email: false, sms: false };

  if (employee.email) {
    results.email = await sendEmail(employee.email, subject, message);
  }

  if (employee.phone && employee.carrier) {
    // SMS messages should be shorter
    const smsText = message.length > 160 ? message.substring(0, 157) + '...' : message;
    results.sms = await sendSMS(employee.phone, employee.carrier, smsText);
  }

  return results;
}

module.exports = { sendEmail, sendSMS, sendNotification, CARRIER_GATEWAYS, APP_URL };

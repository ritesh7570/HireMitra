// Email service for sending approved cold emails through Gmail app passwords.
import nodemailer from 'nodemailer';

export async function sendColdEmail({ to, subject, body, gmailUser, gmailAppPassword, attachments = [] }) {
  if (!to) {
    throw new Error('No recipient email was found in the job description.');
  }

  if (!gmailUser || !gmailAppPassword) {
    throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD are required to send email.');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailAppPassword
    }
  });

  await transporter.sendMail({
    from: gmailUser,
    to,
    subject,
    text: body,
    attachments
  });
}

export async function sendHtmlEmail({ to, subject, html, gmailUser, gmailAppPassword, attachments = [] }) {
  if (!to) {
    throw new Error('No recipient email provided.');
  }

  if (!gmailUser || !gmailAppPassword) {
    throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD are required to send email.');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailAppPassword
    }
  });

  await transporter.sendMail({
    from: gmailUser,
    to,
    subject,
    html,
    attachments
  });
}

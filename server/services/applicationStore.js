// MongoDB persistence service for application drafts and statuses.
import mongoose from 'mongoose';

const applicationSchema = new mongoose.Schema(
  {
    jobTitle: { type: String, required: true },
    company: { type: String, required: true },
    jdText: { type: String, required: true },
    recruiterEmail: { type: String, default: '' },
    recruiterName: { type: String, default: '' },
    source: { type: String, default: 'manual' },
    applyUrl: { type: String, default: '' },
    eligibilityScore: { type: Number, required: true },
    missingSkills: { type: [String], default: [] },
    changesMade: { type: [String], default: [] },
    coldEmailDraft: { type: String, default: '' },
    coldEmailSubject: { type: String, default: '' },
    coldEmailBody: { type: String, default: '' },
    referralMessageDraft: { type: String, default: '' },
    tailoredResumePath: { type: String, default: '' },
    emailSent: { type: Boolean, default: false },
    emailSentAt: { type: Date, default: null },
    postedDate: { type: Date, default: null },
    applicationDeadline: { type: Date, default: null },
    appliedAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: [
        'drafted',
        'applied',
        'auto_applied',
        'email_sent',
        'needs_manual',
        'notified',
        'referral_sent',
        'rejected',
        'interview',
        'captcha_blocked'
      ],
      default: 'drafted'
    }
  },
  { versionKey: false }
);

// Shared by every model in this project (Application, HrContact) since they all use the
// same single mongoose connection singleton.
export async function ensureConnected({ mongoUri, mongoDbName }) {
  if (!mongoUri) {
    throw new Error('MONGO_URI is missing. Add it to .env to enable MongoDB logging.');
  }
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongoUri, { dbName: mongoDbName || 'job_application_agent' });
  }
}

export async function connectApplicationStore({ mongoUri, mongoDbName }) {
  await ensureConnected({ mongoUri, mongoDbName });
  return mongoose.models.Application || mongoose.model('Application', applicationSchema);
}

export async function getApplicationModel({ mongoUri, mongoDbName }) {
  return connectApplicationStore({ mongoUri, mongoDbName });
}

// Defaults to NOT disconnecting: mongoose.connect() is a process-wide singleton, and
// disconnecting it after every save broke concurrent BullMQ jobs sharing the connection
// ("Client must be connected before running operations"). One-shot CLI scripts
// (agent.js, autoApply.js, pipeline.js) call disconnectApplicationStore() once at the end
// of their own main() instead, so the process still exits cleanly.
export async function saveApplication({ mongoUri, mongoDbName, application, disconnect = false }) {
  const Application = await connectApplicationStore({ mongoUri, mongoDbName });
  const saved = await Application.create(application);
  if (disconnect) {
    await mongoose.disconnect();
  }
  return saved;
}

export async function disconnectApplicationStore() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

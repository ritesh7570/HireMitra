// MongoDB persistence service for application drafts and statuses.
import mongoose from 'mongoose';

const applicationSchema = new mongoose.Schema(
  {
    jobTitle: { type: String, required: true },
    company: { type: String, required: true },
    jdText: { type: String, required: true },
    eligibilityScore: { type: Number, required: true },
    missingSkills: { type: [String], default: [] },
    changesMade: { type: [String], default: [] },
    coldEmailDraft: { type: String, default: '' },
    referralMessageDraft: { type: String, default: '' },
    tailoredResumePath: { type: String, default: '' },
    emailSent: { type: Boolean, default: false },
    appliedAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ['drafted', 'applied', 'referral_sent', 'rejected', 'interview'],
      default: 'drafted'
    }
  },
  { versionKey: false }
);

export async function saveApplication({ mongoUri, mongoDbName, application }) {
  if (!mongoUri) {
    throw new Error('MONGO_URI is missing. Add it to .env to enable MongoDB logging.');
  }

  await mongoose.connect(mongoUri, {
    dbName: mongoDbName || 'job_application_agent'
  });

  const Application = mongoose.models.Application || mongoose.model('Application', applicationSchema);
  const saved = await Application.create(application);
  await mongoose.disconnect();
  return saved;
}

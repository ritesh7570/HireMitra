// MongoDB persistence for the uploaded HR-contact list (name/company/email parsed from a
// freeform PDF/DOCX) and the daily cold-email batch's send tracking.
import mongoose from 'mongoose';
import { ensureConnected } from './applicationStore.js';

const hrContactSchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    company: { type: String, default: '' },
    email: { type: String, required: true, unique: true },
    role: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    sourceFile: { type: String, default: '' },
    emailSent: { type: Boolean, default: false },
    emailedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

async function getHrContactModel() {
  await ensureConnected({ mongoUri: process.env.MONGO_URI, mongoDbName: process.env.MONGO_DB_NAME });
  return mongoose.models.HrContact || mongoose.model('HrContact', hrContactSchema);
}

// Inserts contacts, skipping any whose email already exists (case-insensitive) rather
// than erroring out the whole upload on one duplicate.
export async function saveHrContacts(contacts, sourceFile = '') {
  const HrContact = await getHrContactModel();
  let inserted = 0;
  let skipped = 0;

  for (const contact of contacts) {
    const email = (contact.email || '').trim().toLowerCase();
    if (!email) {
      skipped += 1;
      continue;
    }
    try {
      await HrContact.create({
        name: contact.name || '',
        company: contact.company || '',
        email,
        role: contact.role || '',
        linkedin: contact.linkedin || '',
        sourceFile
      });
      inserted += 1;
    } catch (error) {
      if (error.code === 11000) {
        skipped += 1;
      } else {
        throw error;
      }
    }
  }

  return { inserted, skipped };
}

export async function listHrContacts({ page = 1, limit = 50 } = {}) {
  const HrContact = await getHrContactModel();
  const [items, total, sentCount] = await Promise.all([
    HrContact.find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    HrContact.countDocuments(),
    HrContact.countDocuments({ emailSent: true })
  ]);
  return { items, total, sentCount, page, limit };
}

export async function getUnsentHrContacts(limit) {
  const HrContact = await getHrContactModel();
  return HrContact.find({ emailSent: false }).sort({ createdAt: 1 }).limit(limit);
}

export async function setHrContactSent(id, sent = true) {
  const HrContact = await getHrContactModel();
  return HrContact.findByIdAndUpdate(
    id,
    { emailSent: sent, emailedAt: sent ? new Date() : null },
    { new: true }
  ).lean();
}

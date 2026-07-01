// MongoDB persistence for HR/recruiter contacts, grouped by company — company name is
// the "key" (stored alphabetically via the companyKey index), and each company document
// holds an array of HR entries (name/email/role/linkedin). A new HR found later for an
// already-known company gets pushed into that same company's array instead of creating
// a new top-level record. This is also where any future scraper-sourced HR data should
// land (call saveHrContacts() with the same { name, company, email, role, linkedin }
// shape it already accepts).
import mongoose from 'mongoose';
import { ensureConnected } from './applicationStore.js';

const hrEntrySchema = new mongoose.Schema(
  {
    name: { type: String, default: '' },
    email: { type: String, required: true },
    role: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    sourceFile: { type: String, default: '' },
    emailSent: { type: Boolean, default: false },
    emailedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const hrCompanySchema = new mongoose.Schema(
  {
    companyKey: { type: String, required: true, unique: true }, // normalized: trimmed, lowercase
    company: { type: String, required: true }, // display name, as first seen
    hrs: { type: [hrEntrySchema], default: [] }
  },
  { versionKey: false }
);

function normalizeCompanyKey(company) {
  const trimmed = (company || '').trim().toLowerCase();
  return trimmed || 'unknown company';
}

let migrationChecked = false;

// One-time migration of the old flat `hrcontacts` collection (pre-company-grouping) into
// the new `hrcompanies` shape, preserving emailSent/emailedAt/createdAt so nothing about
// contacts already emailed gets lost. No-ops once the new collection has any data.
async function migrateFromFlatCollectionIfNeeded(HrCompany) {
  if (migrationChecked) return;
  migrationChecked = true;

  const existingCount = await HrCompany.countDocuments();
  if (existingCount > 0) return;

  const flatDocs = await mongoose.connection.db.collection('hrcontacts').find({}).toArray();
  if (flatDocs.length === 0) return;

  console.log(`HR contacts: migrating ${flatDocs.length} contact(s) from the old flat collection into company groups...`);
  const grouped = new Map();
  for (const doc of flatDocs) {
    const companyKey = normalizeCompanyKey(doc.company);
    if (!grouped.has(companyKey)) {
      grouped.set(companyKey, {
        companyKey,
        company: (doc.company || '').trim() || 'Unknown Company',
        hrs: []
      });
    }
    grouped.get(companyKey).hrs.push({
      name: doc.name || '',
      email: doc.email,
      role: doc.role || '',
      linkedin: doc.linkedin || '',
      sourceFile: doc.sourceFile || '',
      emailSent: doc.emailSent || false,
      emailedAt: doc.emailedAt || null,
      createdAt: doc.createdAt || new Date()
    });
  }

  await HrCompany.insertMany([...grouped.values()]);
  console.log(`HR contacts: migrated into ${grouped.size} company group(s).`);
}

async function getHrCompanyModel() {
  await ensureConnected({ mongoUri: process.env.MONGO_URI, mongoDbName: process.env.MONGO_DB_NAME });
  const HrCompany = mongoose.models.HrCompany || mongoose.model('HrCompany', hrCompanySchema);
  await migrateFromFlatCollectionIfNeeded(HrCompany);
  return HrCompany;
}

// Upserts contacts into their company's group, skipping any contact whose email already
// exists within that same company (case-insensitive) rather than failing the whole batch.
export async function saveHrContacts(contacts, sourceFile = '') {
  const HrCompany = await getHrCompanyModel();
  let inserted = 0;
  let skipped = 0;

  for (const contact of contacts) {
    const email = (contact.email || '').trim().toLowerCase();
    if (!email) {
      skipped += 1;
      continue;
    }

    const companyKey = normalizeCompanyKey(contact.company);
    const companyDisplay = (contact.company || '').trim() || 'Unknown Company';

    let group = await HrCompany.findOne({ companyKey });
    if (!group) {
      group = new HrCompany({ companyKey, company: companyDisplay, hrs: [] });
    }

    const alreadyExists = group.hrs.some((hr) => hr.email.toLowerCase() === email);
    if (alreadyExists) {
      skipped += 1;
      continue;
    }

    group.hrs.push({
      name: contact.name || '',
      email,
      role: contact.role || '',
      linkedin: contact.linkedin || '',
      sourceFile
    });
    await group.save();
    inserted += 1;
  }

  return { inserted, skipped };
}

// Returns company groups sorted alphabetically by company name, optionally filtered by a
// case-insensitive substring match on the company name (the HR Contacts page search box).
export async function listHrContacts({ page = 1, limit = 50, search = '' } = {}) {
  const HrCompany = await getHrCompanyModel();
  const filter = search ? { company: { $regex: search.trim(), $options: 'i' } } : {};

  const [companies, totalCompanies] = await Promise.all([
    HrCompany.find(filter)
      .sort({ companyKey: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    HrCompany.countDocuments(filter)
  ]);

  return { companies, totalCompanies, page, limit };
}

// Flattens unsent HR entries across every company, oldest-first, for the daily/manual
// batch sender. Returns plain objects (not subdocuments) with the fields the sender uses.
export async function getUnsentHrContacts(limit) {
  const HrCompany = await getHrCompanyModel();
  return HrCompany.aggregate([
    { $unwind: '$hrs' },
    { $match: { 'hrs.emailSent': false } },
    { $sort: { 'hrs.createdAt': 1 } },
    { $limit: limit },
    {
      $project: {
        _id: '$hrs._id',
        company: '$company',
        name: '$hrs.name',
        email: '$hrs.email',
        role: '$hrs.role',
        linkedin: '$hrs.linkedin'
      }
    }
  ]);
}

export async function setHrContactSent(hrId, sent = true) {
  const HrCompany = await getHrCompanyModel();
  const updated = await HrCompany.findOneAndUpdate(
    { 'hrs._id': hrId },
    { $set: { 'hrs.$.emailSent': sent, 'hrs.$.emailedAt': sent ? new Date() : null } },
    { new: true }
  ).lean();

  if (!updated) return null;
  const hr = updated.hrs.find((entry) => String(entry._id) === String(hrId));
  return hr ? { ...hr, company: updated.company } : null;
}

export async function getHrContactStats() {
  const HrCompany = await getHrCompanyModel();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [result] = await HrCompany.aggregate([
    { $unwind: '$hrs' },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        sentCount: { $sum: { $cond: ['$hrs.emailSent', 1, 0] } },
        sentToday: {
          $sum: {
            $cond: [{ $and: ['$hrs.emailSent', { $gte: ['$hrs.emailedAt', startOfToday] }] }, 1, 0]
          }
        }
      }
    }
  ]);

  const total = result?.total || 0;
  const sentCount = result?.sentCount || 0;
  const sentToday = result?.sentToday || 0;
  return { total, sentCount, sentToday, remaining: total - sentCount };
}

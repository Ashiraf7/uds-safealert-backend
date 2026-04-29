// scripts/seed.js — seed demo users and alerts
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase') ? { rejectUnauthorized: false } : false,
});

// UDS Nyankpala campus centre ~ 9.4055, -0.9706
const CAMPUS = { lat: 9.4055, lng: -0.9706 };
const jitter = (n) => CAMPUS.lat + (Math.random() - 0.5) * n;
const jitterLng = (n) => CAMPUS.lng + (Math.random() - 0.5) * n;

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱  Seeding database…');

    const hash = await bcrypt.hash('password123', 10);

    // Admin user
    const adminId = uuidv4();
    await client.query(
      `INSERT INTO users (id,name,email,phone,password_hash,student_id,department,hostel,role,lat,lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'admin',$9,$10)
       ON CONFLICT (email) DO NOTHING`,
      [adminId,'Campus Admin','admin@uds.edu.gh','+233244000001',hash,'ADM/001/20','Staff / Faculty','Off-campus',CAMPUS.lat,CAMPUS.lng]
    );

    // Sample students
    const students = [
      ['Ama Asante',     'ama@uds.edu.gh',    '+233245678901','CSC/0012/25','Computer Science',   'Hostel C (Female)'],
      ['Kwame Boateng',  'kwame@uds.edu.gh',  '+233202345678','AGR/0045/23','Agricultural Science','Hostel A (Male)'],
      ['Fatima Ibrahim', 'fatima@uds.edu.gh', '+233503456789','HLT/0100/24','Health Sciences',    'Hostel D (Female)'],
      ['Yaw Owusu',      'yaw@uds.edu.gh',    '+233264567890','ENG/0001/22','Engineering',        'Hostel B (Male)'],
      ['Abena Mensah',   'abena@uds.edu.gh',  '+233245670123','BUS/0067/25','Business Administration','Hostel C (Female)'],
    ];

    const studentIds = [];
    for (const [name,email,phone,sid,dept,hostel] of students) {
      const id = uuidv4();
      studentIds.push(id);
      await client.query(
        `INSERT INTO users (id,name,email,phone,password_hash,student_id,department,hostel,role,lat,lng)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'student',$9,$10)
         ON CONFLICT (email) DO NOTHING`,
        [id,name,email,phone,hash,sid,dept,hostel,jitter(0.01),jitterLng(0.01)]
      );
    }

    // Sample alerts (some active, some resolved)
    const alertRows = [
      { type:'fire',     title:'Fire Alert — Main Hall',
        desc:'Smoke detected near Main Hall kitchen. Students urged to evacuate via east exits.',
        loc:'Main Hall · Block C', status:'active',   reporter:studentIds[0] },
      { type:'security', title:'Security Threat — Hostel A Gate',
        desc:'Suspicious individuals reported near Hostel A main gate. Security notified.',
        loc:'Hostel A · Main Gate', status:'active',  reporter:studentIds[1] },
      { type:'flood',    title:'Flood Warning — Campus Road',
        desc:'Heavy rainfall causing waterlogging on the main campus road near the clinic.',
        loc:'Main Campus Road', status:'active',      reporter:adminId },
      { type:'medical',  title:'Medical Emergency Resolved',
        desc:'Student fainted near the library. First aid administered, transferred to clinic.',
        loc:'Library Block', status:'resolved',       reporter:studentIds[2] },
    ];

    for (const a of alertRows) {
      await client.query(
        `INSERT INTO alerts (type,title,description,location_label,lat,lng,status,reporter_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [a.type,a.title,a.desc,a.loc,jitter(0.005),jitterLng(0.005),a.status,a.reporter]
      );
    }

    console.log('✅  Seed complete.');
    console.log('   Admin login: admin@uds.edu.gh / password123');
    console.log('   Student login: ama@uds.edu.gh / password123');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(e => { console.error(e); process.exit(1); });

/**
 * Setup Test Salon for Inbox development
 * Run: node setup-test-salon.js
 * 
 * Creates:
 * - Test Salon in Firestore
 * - 3 test users (technician, manager, admin)
 */

const admin = require('firebase-admin');

// Initialize (uses application default credentials)
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const SALON_ID = 'test_salon_001';
const SALON_NAME = 'Demo Salon';

async function setupTestSalon() {
  console.log('🏗️  Setting up Test Salon...\n');

  try {
    // 1. Create salon
    console.log('1️⃣  Creating salon:', SALON_ID);
    await db.collection('salons').doc(SALON_ID).set({
      name: SALON_NAME,
      email: 'demo@fairflowapp.com',
      locations: ['main'],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      plan: 'trial',
      isTestSalon: true
    });
    console.log('   ✅ Salon created\n');

    // 2. Create test users
    const testUsers = [
      {
        email: 'tech_test@fairflowapp.com',
        password: 'Test1234!',
        role: 'technician',
        name: 'Tech Test',
        staffId: 'staff_tech_001'
      },
      {
        email: 'manager_test@fairflowapp.com',
        password: 'Test1234!',
        role: 'manager',
        name: 'Manager Test',
        staffId: 'staff_manager_001'
      },
      {
        email: 'admin_test@fairflowapp.com',
        password: 'Test1234!',
        role: 'admin',
        name: 'Admin Test',
        staffId: 'staff_admin_001'
      }
    ];

    console.log('2️⃣  Creating test users...');
    
    for (const user of testUsers) {
      try {
        // Create Firebase Auth user
        const userRecord = await admin.auth().createUser({
          email: user.email,
          password: user.password,
          displayName: user.name
        });
        
        console.log(`   📧 Created auth: ${user.email} (${userRecord.uid})`);

        // Create Firestore user profile
        await db.collection('users').doc(userRecord.uid).set({
          email: user.email,
          emailLower: user.email.toLowerCase(),
          name: user.name,
          role: user.role,
          salonId: SALON_ID,
          staffId: user.staffId,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          isTestUser: true
        });
        
        console.log(`   ✅ Created profile: ${user.name} (${user.role})\n`);
        
      } catch (err) {
        if (err.code === 'auth/email-already-exists') {
          console.log(`   ⚠️  User ${user.email} already exists, skipping...\n`);
        } else {
          throw err;
        }
      }
    }

    console.log('\n🎉 Test Salon setup complete!\n');
    console.log('📝 Test credentials:');
    console.log('   Technician: tech_test@fairflowapp.com / Test1234!');
    console.log('   Manager:    manager_test@fairflowapp.com / Test1234!');
    console.log('   Admin:      admin_test@fairflowapp.com / Test1234!\n');
    console.log('🔗 Salon ID:', SALON_ID);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

setupTestSalon()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

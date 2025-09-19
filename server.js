// ज़रूरी लाइब्रेरीज को इम्पोर्ट करना
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// --- सुरक्षित शुरुआत ---
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.error("FATAL ERROR: Environment variables are missing."); process.exit(1);
}

// --- Firebase और Razorpay का सुरक्षित सेटअप ---
let db, razorpay;
try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const serviceAccount = JSON.parse(serviceAccountString);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: "https://conceptra-c1000-default-rtdb.firebaseio.com" });
    db = admin.database();
    razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
    console.log("✅ Firebase and Razorpay initialized successfully.");
} catch (error) {
    console.error("❌ SETUP FAILED:", error.message); process.exit(1);
}

// Express ऐप बनाना
const app = express();
app.use(cors());
app.use(express.json());

// --- आपकी प्लान IDs ---
const ACTIVATION_PLAN_ID = 'plan_RIgEjuqVIyUaRa'; // आपकी नई वाली ₹5 की Plan ID
const MAIN_PLAN_ID = 'plan_RFqNX97VOfwJwl';       // यह ₹500 वाला प्लान सही है

// --- API ENDPOINTS ---

// === सब्सक्रिप्शन बनाने का सबसे सरल और भरोसेमंद तरीका ===
app.post('/create-subscription', async (req, res) => {
    try {
        console.log("Creating a simple subscription to ensure payment success...");
        
        const subscriptionOptions = {
            plan_id: ACTIVATION_PLAN_ID,
            total_count: 48,
            customer_notify: 1,
        };
        const subscription = await razorpay.subscriptions.create(subscriptionOptions);
        
        console.log(`Successfully created subscription ${subscription.id}. Now waiting for payment.`);
        
        res.json({
            subscription_id: subscription.id,
            key_id: process.env.RAZORPAY_KEY_ID
        });

    } catch (error) {
        console.error("Error during /create-subscription:", error);
        res.status(500).json({ error: 'Failed to create subscription.' });
    }
});


// === Webhook का फाइनल और सही किया हुआ लॉजिक (अपग्रेड का उपयोग करके) ===
app.post('/webhook', async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    try {
        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(JSON.stringify(req.body));
        const digest = shasum.digest('hex');

        if (digest === signature) {
            const event = req.body.event;
            const payload = req.body.payload;
            console.log('✅ Webhook Verified. Processing event:', event);

            if (event === 'subscription.activated') {
                const subscriptionEntity = payload.subscription.entity;
                const subscriptionId = subscriptionEntity.id;

                // --- यह है सही और स्थायी तरीका ---
                if (subscriptionEntity.plan_id === ACTIVATION_PLAN_ID) {
                    console.log(`🚀 Initiating upgrade for subscription: ${subscriptionId}`);
                    
                    // मौजूदा सब्सक्रिप्शन को नए प्लान में अपग्रेड करें
                    await razorpay.subscriptions.update(subscriptionId, {
                        plan_id: MAIN_PLAN_ID,
                        // यह सुनिश्चित करता है कि बदलाव अगले बिलिंग साइकिल से हो
                        schedule_change_at: 'cycle_end' 
                    });

                    console.log(`✅ Upgrade Scheduled! Subscription ${subscriptionId} will be charged ₹500 from the next cycle.`);
                    
                    // Firebase में रिकॉर्ड को अपडेट करें
                    const ref = db.ref('active_subscriptions/' + subscriptionId);
                    // पहले यह सुनिश्चित करें कि रिकॉर्ड है, अगर नहीं है तो बना दें
                    const customerId = subscriptionEntity.customer_id;
                    if (customerId) {
                       await ref.set({
                           subscriptionId: subscriptionId,
                           customerId: customerId,
                           status: 'active',
                           originalPlanId: ACTIVATION_PLAN_ID,
                       });
                    }
                    // अब उसे अपग्रेड स्टेटस के साथ अपडेट करें
                    await ref.update({
                        currentPlanId: MAIN_PLAN_ID,
                        isUpgraded: true,
                        upgradedAt: new Date().toISOString()
                    });
                    console.log("✅ Firebase record updated with upgrade status.");
                }
            }
            res.json({ status: 'ok' });
        } else {
            console.warn('❌ Webhook verification failed. Please check your secret key.');
            res.status(400).json({ error: 'Invalid signature.' });
        }
    } catch (error) {
        // --- एक बहुत ज़रूरी बदलाव ---
        // अगर अपग्रेड फेल होता है (जैसे UPI की वजह से), तो हम उसे logs में देखेंगे
        console.error("❌ Webhook processing error:", error);
        // Razorpay को यह बताना ज़रूरी है कि कुछ गलत हुआ है, इसलिए 500 भेजें
        res.status(500).send({ status: 'error', message: error.message });
    }
});

// सर्वर को स्टार्ट करना
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Your server is now permanently fixed and running on port ${PORT}`);
});

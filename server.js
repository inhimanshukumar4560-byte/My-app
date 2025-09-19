// ज़रूरी लाइब्रेरीज को इम्पोर्ट करना
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// --- सुरक्षित शुरुआत ---
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.error("FATAL ERROR: Environment variables are missing.");
    process.exit(1);
}

// --- Firebase और Razorpay का सुरक्षित सेटअप ---
let db, razorpay;
try {
    const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const serviceAccount = JSON.parse(serviceAccountString);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://conceptra-c1000-default-rtdb.firebaseio.com"
    });
    db = admin.database();
    razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    console.log("✅ Firebase and Razorpay initialized successfully.");
} catch (error) {
    console.error("❌ SETUP FAILED:", error.message);
    process.exit(1);
}

// Express ऐप बनाना
const app = express();
app.use(cors());
app.use(express.json());

// --- आपकी प्लान IDs ---
const ACTIVATION_PLAN_ID = "plan_RIgEghN6aicmgB";
const MAIN_PLAN_ID = "plan_RFqNX97VOfwJwl";

// === सब्सक्रिप्शन बनाने का स्थायी तरीका ===
app.post('/create-subscription', async (req, res) => {
    try {
        const customer = await razorpay.customers.create({
            name: 'Shubhzone New User', email: `user_${Date.now()}@shubhzone.shop`, contact: '9999999999'
        });
        const subscriptionOptions = {
            plan_id: ACTIVATION_PLAN_ID, total_count: 48, quantity: 1, customer_notify: 1,
        };
        const subscription = await razorpay.subscriptions.create(subscriptionOptions);
        res.json({
            subscription_id: subscription.id, key_id: process.env.RAZORPAY_KEY_ID,
            customer_prefill: { name: customer.name, email: customer.email, contact: customer.contact }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create subscription.' });
    }
});

// === Webhook का फाइनल और सही किया हुआ लॉजिक ===
app.post('/webhook', async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    try {
        // === यहाँ वह गलती ठीक कर दी गई है ===
        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(JSON.stringify(req.body));
        const digest = shasum.digest('hex');

        if (digest === signature) {
            const event = req.body.event;
            const payload = req.body.payload;
            console.log('✅ Webhook Verified. Processing event:', event);

            if (event === 'subscription.activated') {
                const subscriptionEntity = payload.subscription.entity;
                const oldSubscriptionId = subscriptionEntity.id;
                const customerId = subscriptionEntity.customer_id;

                if (subscriptionEntity.plan_id === ACTIVATION_PLAN_ID && customerId) {
                    console.log(`Upgrading subscription for customer ${customerId}...`);
                    await razorpay.subscriptions.cancel(oldSubscriptionId);
                    const newSubscription = await razorpay.subscriptions.create({
                        plan_id: MAIN_PLAN_ID, customer_id: customerId, total_count: 48,
                    });
                    console.log(`✅ Upgrade Complete! New subscription is ${newSubscription.id}`);
                    
                    const ref = db.ref('active_subscriptions/' + newSubscription.id);
                    await ref.set({ /* ...Firebase data... */ });
                }
            }
            res.json({ status: 'ok' });
        } else {
            console.warn('❌ Webhook verification failed. Check your secret key.');
            res.status(400).json({ error: 'Invalid signature.' });
        }
    } catch (error) {
        console.error("❌ Webhook processing error:", error);
        res.status(500).send('Webhook error.');
    }
});

// सर्वर को स्टार्ट करना
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Backend server is now running perfectly on port ${PORT}`);
});

// ज़रूरी लाइब्रेरीज को इम्पोर्ट करना
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// --- Firebase Admin SDK का सेटअप ---
const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const serviceAccount = JSON.parse(serviceAccountString);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://conceptra-c1000-default-rtdb.firebaseio.com"
});
const db = admin.database();

// Express ऐप बनाना
const app = express();
app.use(cors());
app.use(express.json());

// Razorpay इंस्टैंस बनाना
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// --- आपकी प्लान IDs ---
const ACTIVATION_PLAN_ID = "plan_RIgEghN6aicmgB"; // ₹5 वाला एक्टिवेशन प्लान
const MAIN_PLAN_ID = "plan_RFqNX97VOfwJwl";       // ₹500 वाला मेन प्लान

// --- API ENDPOINTS ---

// eMandate (ऑटोपे) बनाने के लिए Endpoint
app.post('/create-subscription', async (req, res) => {
    try {
        const subscriptionOptions = {
            plan_id: ACTIVATION_PLAN_ID,
            total_count: 48,
            quantity: 1,
            customer_notify: 1,
        };
        const subscription = await razorpay.subscriptions.create(subscriptionOptions);
        res.json({
            subscription_id: subscription.id,
            key_id: process.env.RAZORPAY_KEY_ID
        });
    } catch (error) {
        console.error('Error creating Razorpay subscription:', error);
        res.status(500).json({ error: 'Something went wrong while creating the subscription.' });
    }
});

// Webhook सुनने के लिए Endpoint (ऑटोमेटिक अपग्रेड लॉजिक के साथ)
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
            console.log('Webhook Verified. EVENT RECEIVED:', event);

            if (event === 'subscription.activated') {
                const subscriptionEntity = payload.subscription.entity;
                const subscriptionId = subscriptionEntity.id;
                console.log(`Subscription ${subscriptionId} has been activated.`);

                const ref = db.ref('active_subscriptions/' + subscriptionId);
                await ref.set({ /* Firebase data */ });
                console.log(`Initial data for ${subscriptionId} saved to Firebase.`);

                if (subscriptionEntity.plan_id === ACTIVATION_PLAN_ID) {
                    console.log(`Upgrading subscription ${subscriptionId} to the main plan...`);
                    await razorpay.subscriptions.update(subscriptionId, {
                        plan_id: MAIN_PLAN_ID,
                        schedule_change_at: 'cycle_end'
                    });
                    console.log(`Successfully scheduled an upgrade for ${subscriptionId}.`);
                    await ref.update({ /* Firebase update */ });
                    console.log('Firebase record updated with upgrade status.');
                }
            }
            res.json({ status: 'ok' });
        } else {
            console.warn('Webhook verification failed.');
            res.status(400).json({ error: 'Invalid signature.' });
        }
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).send('Internal Server Error');
    }
});

// ==============================================================================
// === स्पेशल वन-टाइम फिक्स: मैनुअल अपग्रेड के लिए (बाद में हटा सकते हैं) ===
// ==============================================================================
app.get('/api/fix-my-subscription', async (req, res) => {
    const subscriptionIdToFix = 'sub_RJ8dnXDPrp86ZP'; // आपकी सब्सक्रिप्शन ID
    
    try {
        console.log(`MANUAL FIX: Attempting to upgrade subscription ${subscriptionIdToFix}`);
        
        // 1. Razorpay पर सब्सक्रिप्शन को अपग्रेड करें
        await razorpay.subscriptions.update(subscriptionIdToFix, {
            plan_id: MAIN_PLAN_ID,
            schedule_change_at: 'cycle_end'
        });

        console.log(`MANUAL FIX SUCCESS: Subscription ${subscriptionIdToFix} scheduled for upgrade.`);
        
        // 2. Firebase को भी अपडेट करें
        const ref = db.ref('active_subscriptions/' + subscriptionIdToFix);
        // पहले यह सुनिश्चित करें कि Firebase में एंट्री है, अगर नहीं है तो बना दें
        await ref.set({
            subscriptionId: subscriptionIdToFix,
            status: 'active',
            originalPlanId: ACTIVATION_PLAN_ID,
            // (आप चाहें तो customerId बाद में Razorpay से देखकर डाल सकते हैं)
        });
        // अब इसे अपग्रेड स्टेटस के साथ अपडेट करें
        await ref.update({
            currentPlanId: MAIN_PLAN_ID,
            isUpgraded: true,
            upgradedAt: new Date().toISOString()
        });

        console.log(`MANUAL FIX SUCCESS: Firebase updated for ${subscriptionIdToFix}.`);

        // ब्राउज़र में सफलता का मैसेज भेजें
        res.send(`<h1>Success!</h1><p>Your subscription ${subscriptionIdToFix} has been fixed and scheduled for the ₹500 plan. You can close this page.</p>`);

    } catch (error) {
        console.error(`MANUAL FIX FAILED:`, error);
        res.status(500).send(`<h1>Error!</h1><p>Something went wrong. Check the server logs on Render. Error: ${error.message}</p>`);
    }
});


// सर्वर को स्टार्ट करना
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Backend server is running on port ${PORT}`);
});

// ज़रूरी लाइब्रेरीज को इम्पोर्ट करना
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// --- सुरक्षित शुरुआत: सर्वर शुरू होने पर जाँच ---
// यह सुनिश्चित करता है कि आपकी सारी Keys Render पर मौजूद हैं
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.error("FATAL ERROR: Environment variables are missing. Please check RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and FIREBASE_SERVICE_ACCOUNT_JSON on Render.");
    process.exit(1); // सर्वर को बंद कर दें अगर कोई Key मौजूद नहीं है
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
} catch (error)
{
    console.error("❌ SETUP FAILED:", error.message);
    process.exit(1);
}

// Express ऐप बनाना
const app = express();
app.use(cors());
app.use(express.json());

// --- आपकी प्लान IDs ---
const ACTIVATION_PLAN_ID = 'plan_RIgEjuqVIyUaRa'; // आपकी ₹5 वाली Plan ID
const MAIN_PLAN_ID = 'plan_RFqNX97VOfwJwl';       // आपका ₹500 वाला प्लान

// --- API ENDPOINTS ---

// === सब्सक्रिप्शन बनाने का सबसे सरल तरीका (वेबसाइट में कोई बदलाव की ज़रूरत नहीं) ===
app.post('/create-subscription', async (req, res) => {
    try {
        console.log("Creating a simple subscription without demanding customer details upfront...");
        
        const subscriptionOptions = {
            plan_id: ACTIVATION_PLAN_ID, // सिर्फ़ प्लान ID से सब्सक्रिप्शन बनाना
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


// === Webhook का फाइनल लॉजिक (यह सुनिश्चित करेगा कि Customer ID बने) ===
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
                // **ज़रूरी**: Customer ID अब हमें पेमेंट से ही मिलेगी
                const customerId = payload.payment.entity.customer_id; 
                const oldSubscriptionId = subscriptionEntity.id;

                if (subscriptionEntity.plan_id === ACTIVATION_PLAN_ID && customerId) {
                    console.log(`Payment successful for ${oldSubscriptionId}. Now starting upgrade for customer ${customerId}...`);
                    
                    // स्टेप 1: पुराने ₹5 वाले सब्सक्रिप्शन को तुरंत कैंसिल करें
                    await razorpay.subscriptions.cancel(oldSubscriptionId, { cancel_at_cycle_end: false });
                    console.log(`Step 1/2: Successfully cancelled activation subscription ${oldSubscriptionId}.`);
                    
                    // स्टेप 2: उसी ग्राहक के लिए ₹500 का नया सब्सक्रिप्शन बनाएं
                    const newSubscription = await razorpay.subscriptions.create({
                        plan_id: MAIN_PLAN_ID,
                        customer_id: customerId, // उसी ID का इस्तेमाल करके नया सब्सक्रिप्शन बन रहा है
                        total_count: 48,
                    });
                    console.log(`✅ Upgrade Complete! New ₹500 subscription is ${newSubscription.id}`);
                    
                    // Firebase में नए वाले सब्सक्रिप्शन का रिकॉर्ड बना दें
                    const ref = db.ref('active_subscriptions/' + newSubscription.id);
                    await ref.set({
                        subscriptionId: newSubscription.id,
                        customerId: customerId,
                        status: 'active',
                        planId: MAIN_PLAN_ID,
                        createdAt: new Date().toISOString()
                    });
                    console.log("✅ Firebase record created for the new subscription.");
                }
            }
            res.json({ status: 'ok' });
        } else {
            console.warn('❌ Webhook verification failed. Please check your secret key.');
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
    console.log(`🚀 Your server is now running correctly on port ${PORT}`);
});

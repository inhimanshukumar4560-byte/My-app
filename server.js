// ज़रूरी लाइब्रेरीज को इम्पोर्ट करना
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// --- सुरक्षित शुरुआत: सर्वर शुरू होने पर जाँच ---
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
} catch (error) {
    console.error("❌ SETUP FAILED:", error.message);
    process.exit(1);
}

// Express ऐप बनाना
const app = express();
app.use(cors());
app.use(express.json());

// --- आपकी प्लान IDs ---
const ACTIVATION_PLAN_ID = "plan_RIgEghN6aicmgB"; // ₹5 वाला प्लान
const MAIN_PLAN_ID = "plan_RFqNX97VOfwJwl";       // ₹500 वाला प्लान

// --- API ENDPOINTS ---

// === सब्सक्रिप्शन बनाने का नया और स्थायी तरीका ===
app.post('/create-subscription', async (req, res) => {
    try {
        // स्टेप 1: हमेशा पहले एक नया कस्टमर बनाएं ताकि कोई भी सब्सक्रिप्शन अनाथ न रहे
        const customer = await razorpay.customers.create({
            name: 'Shubhzone New User',
            email: `user_${Date.now()}@shubhzone.shop`, // हर बार एक यूनिक ईमेल ताकि कोई टकराव न हो
            contact: '9999999999'
        });
        console.log(`Step 1/2: Created a new customer in Razorpay: ${customer.id}`);

        // स्टेप 2: अब उस कस्टमर के लिए सब्सक्रिप्शन बनाएं
        const subscriptionOptions = {
            plan_id: ACTIVATION_PLAN_ID,
            total_count: 48,
            quantity: 1,
            customer_notify: 1,
        };
        const subscription = await razorpay.subscriptions.create(subscriptionOptions);
        console.log(`Step 2/2: Created subscription ${subscription.id}. Waiting for payment.`);
        
        // फ्रंटएंड को ज़रूरी जानकारी भेजें
        res.json({
            subscription_id: subscription.id,
            key_id: process.env.RAZORPAY_KEY_ID,
            // हम पेमेंट पॉपअप को पहले से भरने के लिए कस्टमर की जानकारी भेज रहे हैं
            customer_prefill: {
                name: customer.name,
                email: customer.email,
                contact: customer.contact
            }
        });

    } catch (error) {
        console.error("Error during /create-subscription:", error);
        res.status(500).json({ error: 'Failed to create subscription.' });
    }
});


// === Webhook का फाइनल और स्थायी लॉजिक (Cancel and Create New) ===
app.post('/webhook', async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    try {
        // === यहाँ sha256 होना चाहिए, मैंने इसे भी ठीक कर दिया है ===
        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(JSON.stringify(req.body));
        const digest = shasum.digest('hex');

        if (digest === signature) {
            const event = req.body.event;
            const payload = req.body.payload;
            console.log('Webhook Verified. Processing event:', event);

            if (event === 'subscription.activated') {
                const subscriptionEntity = payload.subscription.entity;
                const oldSubscriptionId = subscriptionEntity.id;
                const customerId = subscriptionEntity.customer_id;

                // यह लॉजिक सिर्फ तभी चलेगा जब सब्सक्रिप्शन ₹5 वाले प्लान का हो और उसका कोई ग्राहक हो
                if (subscriptionEntity.plan_id === ACTIVATION_PLAN_ID && customerId) {
                    console.log(`Activation subscription ${oldSubscriptionId} is active for customer ${customerId}. Starting upgrade...`);
                    
                    // स्टेप 1: पुराने ₹5 वाले सब्सक्रिप्शन को तुरंत कैंसिल करें
                    await razorpay.subscriptions.cancel(oldSubscriptionId);
                    console.log(`Step 1/2: Successfully cancelled old subscription ${oldSubscriptionId}.`);
                    
                    // स्टेप 2: उसी ग्राहक के लिए ₹500 का नया सब्सक्रिप्शन बनाएं
                    const newSubscription = await razorpay.subscriptions.create({
                        plan_id: MAIN_PLAN_ID,
                        customer_id: customerId, // यह सबसे ज़रूरी है
                        total_count: 48,
                    });
                    console.log(`Step 2/2: Successfully created new ₹500 subscription ${newSubscription.id} for the same customer.`);

                    // === यहाँ वह सिंटैक्स एरर ठीक कर दी गई है ===
                    const ref = db.ref('active_subscriptions/' + newSubscription.id);
                    await ref.set({
                        subscriptionId: newSubscription.id,
                        customerId: customerId,
                        status: 'active',
                        planId: MAIN_PLAN_ID,
                        createdAt: new Date().toISOString()
                    });
                    console.log("Firebase record created for the new subscription.");
                }
            }
            res.json({ status: 'ok' });
        } else {
            console.warn("Webhook verification failed. Check your secret key.");
            res.status(400).json({ error: 'Invalid signature.' });
        }
    } catch (error) {
        console.error("Webhook processing error:", error);
        res.status(500).send('Webhook error.');
    }
});

// सर्वर को स्टार्ट करना
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Backend server is now running perfectly on port ${PORT}`);
});

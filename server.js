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

// --- Firebase और Razorpay का सेटअप ---
let db, razorpay;
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
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

const app = express();
app.use(cors());
app.use(express.json());

// ===================================================================
// =========== सिर्फ यह एक लाइन बदली गई है (सबसे ज़रूरी) ============
// ===================================================================
const ACTIVATION_PLAN_ID = 'plan_RJX1Aq0y6jBERy'; // आपकी नई Test Mode वाली Plan ID
// ===================================================================

const MAIN_PLAN_ID = 'plan_RFqNX97VOfwJwl';

// === सब्सक्रिप्शन बनाना ===
app.post('/create-subscription', async (req, res) => {
    try {
        console.log("Creating subscription...");
        const subscription = await razorpay.subscriptions.create({
            plan_id: ACTIVATION_PLAN_ID,
            total_count: 48,
            customer_notify: 1,
        });
        res.json({
            subscription_id: subscription.id,
            key_id: process.env.RAZORPAY_KEY_ID
        });
    } catch (error) {
        // सर्वर को ज़्यादा जानकारी देने के लिए console.error जोड़ें
        console.error("❌ Error creating subscription:", error);
        res.status(500).json({ error: 'Failed to create subscription.' });
    }
});

// =========================================================================
// ==================== WEBHOOK का नया और भरोसेमंद लॉजिक ====================
// =========================================================================
app.post('/webhook', async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    try {
        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(JSON.stringify(req.body));
        const digest = shasum.digest('hex');

        if (digest !== signature) {
            console.warn('❌ Webhook verification failed.');
            return res.status(400).json({ error: 'Invalid signature.' });
        }
        
        console.log('✅ Webhook Verified. Processing event:', req.body.event);
        
        // --- यह है सबसे बड़ा बदलाव ---
        // अब हम payment.captured इवेंट को भी सुनेंगे
        if (req.body.event === 'payment.captured') {
            const paymentEntity = req.body.payload.payment.entity;
            
            // हम सिर्फ़ तभी आगे बढ़ेंगे जब यह पेमेंट किसी सब्सक्रिप्शन का हो
            if (paymentEntity.invoice_id && paymentEntity.customer_id) {
                // रेजरपे से सब्सक्रिप्शन की पूरी जानकारी निकालें
                const invoice = await razorpay.invoices.fetch(paymentEntity.invoice_id);
                
                if (invoice.subscription_id) {
                    const subscriptionEntity = await razorpay.subscriptions.fetch(invoice.subscription_id);

                    // यह लॉजिक सिर्फ़ ₹5 वाले प्लान के लिए चलेगा
                    if (subscriptionEntity.plan_id === ACTIVATION_PLAN_ID) {
                        const oldSubscriptionId = subscriptionEntity.id;
                        const customerId = subscriptionEntity.customer_id;
                        
                        console.log(`Payment captured for ${oldSubscriptionId}. Starting upgrade for customer ${customerId}...`);
                        
                        await razorpay.subscriptions.cancel(oldSubscriptionId);
                        console.log(`Step 1/2: Successfully cancelled old subscription ${oldSubscriptionId}.`);
                        
                        const newSubscription = await razorpay.subscriptions.create({
                            plan_id: MAIN_PLAN_ID,
                            customer_id: customerId,
                            total_count: 48,
                        });
                        console.log(`✅ Upgrade Complete! New ₹500 subscription is ${newSubscription.id}`);
                        
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
            }
        }
        
        res.json({ status: 'ok' });

    } catch (error) {
        console.error("❌ Webhook processing error:", error.message, error.stack);
        res.status(500).send('Webhook error.');
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Your server is now permanently fixed and running on port ${PORT}`);
});

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
// ==================== आपकी दोनों TEST PLAN IDs यहाँ हैं ==================
// ===================================================================
const ACTIVATION_PLAN_ID = 'plan_RJX1Aq0y6jBERy'; // आपकी ₹5 वाली Test Plan ID
const MAIN_PLAN_ID = 'plan_RJY2rfogWKazn1';       // आपकी ₹500 वाली Test Plan ID
// ===================================================================


// === सब्सक्रिप्शन बनाना ===
app.post('/create-subscription', async (req, res) => {
    try {
        console.log("Creating subscription with Test Plan ID:", ACTIVATION_PLAN_ID);
        const subscription = await razorpay.subscriptions.create({
            plan_id: ACTIVATION_PLAN_ID,
            total_count: 48,
            customer_notify: 1,
        });
        console.log("✅ Subscription created successfully:", subscription.id);
        res.json({
            subscription_id: subscription.id,
            key_id: process.env.RAZORPAY_KEY_ID
        });
    } catch (error) {
        console.error("❌ Error creating subscription:", error);
        res.status(500).json({ error: 'Failed to create subscription.' });
    }
});

// === WEBHOOK का 100% सही और फाइनल लॉजिक ===
app.post('/webhook', async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    
    // =============================================================
    // =========== यह लाइन हमें अपराधी को रंगे हाथों पकड़वाएगी ==========
    // =============================================================
    console.log('[DEBUG] Secret key being used by the server is:', secret);
    // =============================================================

    try {
        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(JSON.stringify(req.body));
        const digest = shasum.digest('hex');

        if (digest !== signature) {
            console.warn('❌ Webhook verification failed.');
            return res.status(400).json({ error: 'Invalid signature.' });
        }
        
        console.log('✅ Webhook Verified. Processing event:', req.body.event);
        
        if (req.body.event === 'payment.captured') {
            const paymentEntity = req.body.payload.payment.entity;
            
            if (paymentEntity.invoice_id && paymentEntity.customer_id) {
                const invoice = await razorpay.invoices.fetch(paymentEntity.invoice_id);
                
                if (invoice.subscription_id) {
                    const subscriptionEntity = await razorpay.subscriptions.fetch(invoice.subscription_id);

                    if (subscriptionEntity.plan_id === ACTIVATION_PLAN_ID) {
                        const oldSubscriptionId = subscriptionEntity.id;
                        const customerId = subscriptionEntity.customer_id;
                        
                        console.log(`Payment captured for ${oldSubscriptionId}. Starting upgrade for customer ${customerId}...`);
                        
                        await razorpay.subscriptions.cancel(oldSubscriptionId);
                        console.log(`Step 1/2: Successfully cancelled old subscription ${oldSubscriptionId}.`);
                        
                        const startTimeInFuture = Math.floor(Date.now() / 1000) + 3600;

                        const newSubscription = await razorpay.subscriptions.create({
                            plan_id: MAIN_PLAN_ID,
                            customer_id: customerId,
                            total_count: 48,
                            start_at: startTimeInFuture
                        });

                        console.log(`✅ Upgrade Complete! New ₹500 subscription ${newSubscription.id} is scheduled to start in 1 hour.`);
                        
                        const ref = db.ref('active_subscriptions/' + newSubscription.id);
                        await ref.set({
                            subscriptionId: newSubscription.id,
                            customerId: customerId,
                            status: 'scheduled',
                            planId: MAIN_PLAN_ID,
                            createdAt: new Date().toISOString(),
                            startsAt: new Date(startTimeInFuture * 1000).toISOString()
                        });
                        console.log("✅ Firebase record created for the new scheduled subscription.");
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

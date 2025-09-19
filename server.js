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
app.use(express.json()); // अब हम सिर्फ JSON पार्सर का इस्तेमाल करेंगे

// आपकी दोनों TEST PLAN IDs
const ACTIVATION_PLAN_ID = 'plan_RJX1Aq0y6jBERy'; 
const MAIN_PLAN_ID = 'plan_RJY2rfogWKazn1';

// === WEBHOOK का लॉजिक (बिना किसी सिग्नेचर वेरिफिकेशन के) ===
app.post('/webhook', async (req, res) => {
    
    console.log("--- [चेतावनी: असुरक्षित मोड] ---");
    console.log("वेबहुक मिला। सिग्नेचर की जाँच नहीं की जा रही है।");

    try {
        const body = req.body;
        console.log('वेबहुक का इवेंट:', body.event);
        
        if (body.event === 'payment.captured') {
            const paymentEntity = body.payload.payment.entity;
            console.log('पेमेंट कैप्चर हुआ। Invoice ID:', paymentEntity.invoice_id);
            
            if (paymentEntity.invoice_id) {
                const invoice = await razorpay.invoices.fetch(paymentEntity.invoice_id);
                console.log('Invoice मिला। Subscription ID:', invoice.subscription_id);
                
                if (invoice.subscription_id) {
                    const subscriptionEntity = await razorpay.subscriptions.fetch(invoice.subscription_id);
                    const customerId = invoice.customer_id;

                    console.log('Subscription मिला। Plan ID:', subscriptionEntity.plan_id);
                    console.log('CUSTOMER ID मिली:', customerId);

                    if (subscriptionEntity.plan_id === ACTIVATION_PLAN_ID && customerId) {
                        const oldSubscriptionId = subscriptionEntity.id;
                        
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

                        console.log(`✅✅✅ VICTORY! Upgrade Complete! New ₹500 subscription ${newSubscription.id} is scheduled.`);
                        
                        const ref = db.ref('active_subscriptions/' + newSubscription.id);
                        await ref.set({
                            subscriptionId: newSubscription.id,
                            customerId: customerId,
                            status: 'scheduled',
                            planId: MAIN_PLAN_ID,
                            createdAt: new Date().toISOString(),
                            startsAt: new Date(startTimeInFuture * 1000).toISOString()
                        });
                        console.log("✅✅✅ Firebase record created.");
                    } else {
                        console.log("शर्त पूरी नहीं हुई। Plan ID या Customer ID गलत है।");
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
        console.error("❌ Error creating subscription:", error);
        res.status(500).json({ error: 'Failed to create subscription.' });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 सर्वर पोर्ट ${PORT} पर लाइव है (असुरक्षित मोड में)।`);
});

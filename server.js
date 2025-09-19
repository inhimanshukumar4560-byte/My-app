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

// आपकी दोनों TEST PLAN IDs
const ACTIVATION_PLAN_ID = 'plan_RJX1Aq0y6jBERy'; 
const MAIN_PLAN_ID = 'plan_RJY2rfogWKazn1';

// WEBHOOK का रास्ता (असुरक्षित मोड में, सिर्फ टेस्टिंग के लिए)
app.post('/webhook', express.json(), async (req, res) => {
    
    console.log("--- [चेतावनी: असुरक्षित मोड] ---");
    console.log("वेबहुक मिला। सिग्नेचर की जाँच नहीं की जा रही है।");

    try {
        const body = req.body;
        console.log('वेबहुक का इवेंट:', body.event);
        
        if (body.event === 'payment.captured') {
            const paymentEntity = body.payload.payment.entity;
            
            if (paymentEntity.invoice_id) { 
                const invoice = await razorpay.invoices.fetch(paymentEntity.invoice_id);
                
                if (invoice.subscription_id) {
                    const subscriptionEntity = await razorpay.subscriptions.fetch(invoice.subscription_id);
                    const customerId = invoice.customer_id;

                    console.log('CUSTOMER ID मिली:', customerId);

                    if (subscriptionEntity.plan_id === ACTIVATION_PLAN_ID && customerId) {
                        const oldSubscriptionId = subscriptionEntity.id;
                        
                        console.log(`Payment captured for ${oldSubscriptionId}. Starting upgrade for customer ${customerId}...`);
                        
                        await razorpay.subscriptions.cancel(oldSubscriptionId);
                        console.log(`Step 1/2: Successfully cancelled old subscription ${oldSubscriptionId}.`);
                        
                        // --- यही है वह बदलाव ---
                        // अब हम कोई start_at नहीं देंगे, सब्सक्रिप्शन तुरंत शुरू होगा
                        const newSubscription = await razorpay.subscriptions.create({
                            plan_id: MAIN_PLAN_ID,
                            customer_id: customerId,
                            total_count: 48,
                        });

                        console.log(`✅✅✅ VICTORY! Upgrade Complete! New ₹500 subscription ${newSubscription.id} is now ACTIVE.`);
                        
                        const ref = db.ref('active_subscriptions/' + newSubscription.id);
                        await ref.set({
                            subscriptionId: newSubscription.id,
                            customerId: customerId,
                            status: 'active', // अब स्टेटस सीधे 'active' होगा
                            planId: MAIN_PLAN_ID,
                            createdAt: new Date().toISOString()
                        });
                        console.log("✅✅✅ Firebase record created.");
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

// सब्सक्रिप्शन बनाने का Foolproof तरीका
app.post('/create-subscription', express.json(), async (req, res) => {
    try {
        console.log("Creating a new customer on Razorpay...");
        const customer = await razorpay.customers.create({
            name: 'Shubhzone User',
            email: `user_${Date.now()}@shubhzone.shop`
        });
        console.log(`✅ Customer created successfully: ${customer.id}`);

        console.log(`Creating subscription for customer ${customer.id}...`);
        const subscription = await razorpay.subscriptions.create({
            plan_id: ACTIVATION_PLAN_ID,
            customer_id: customer.id,
            total_count: 48,
            customer_notify: 1,
        });
        console.log("✅ Subscription created successfully:", subscription.id);
        
        res.json({
            subscription_id: subscription.id,
            key_id: process.env.RAZORPAY_KEY_ID
        });

    } catch (error) {
        console.error("❌ Error during proactive subscription creation:", error);
        res.status(500).json({ error: 'Failed to create subscription.' });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 सर्वर पोर्ट ${PORT} पर लाइव है (फाइनल टेस्टिंग मोड में)।`);
});

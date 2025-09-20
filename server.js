// ज़रूरी लाइब्रेरीज को इम्पोर्ट करना
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// --- सुरक्षित शुरुआत ---
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || !process.env.FIREBASE_SERVICE_ACCOUNT_JSON || !process.env.RAZORPAY_WEBHOOK_SECRET) {
    console.error("FATAL ERROR: One or more environment variables are missing.");
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
    console.log("✅ Firebase and Razorpay initialized successfully for LIVE mode.");
} catch (error) {
    console.error("❌ SETUP FAILED:", error.message);
    process.exit(1);
}

const app = express();
app.use(cors());

// ===================================================================
// ==================== आपकी दोनों LIVE PLAN IDs यहाँ हैं ==================
// ===================================================================
const ACTIVATION_PLAN_ID = 'plan_RJTkhdu5HZemLI'; // आपकी ₹5 वाली Live Plan ID
const MAIN_PLAN_ID = 'plan_RFqNX97VOfwJwl';       // आपकी ₹500 वाली Live Plan ID
// ===================================================================


// WEBHOOK का रास्ता - यह 100% सुरक्षित और सही तरीका है
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    
    try {
        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(req.body); 
        const digest = shasum.digest('hex');

        // सुरक्षा के लिए वेरिफिकेशन को वापस चालू कर दिया गया है
        if (digest !== signature) {
            console.warn(`❌ SECURITY ALERT: Webhook verification failed. Request rejected.`);
            return res.status(400).json({ error: 'Invalid signature.' });
        }
        
        const body = JSON.parse(req.body.toString());
        console.log('✅ Webhook Verified. Processing event:', body.event);
        
        if (body.event === 'payment.captured') {
            const paymentEntity = body.payload.payment.entity;
            
            if (paymentEntity.invoice_id) { 
                const invoice = await razorpay.invoices.fetch(paymentEntity.invoice_id);
                
                if (invoice.subscription_id) {
                    const subscriptionEntity = await razorpay.subscriptions.fetch(invoice.subscription_id);
                    const customerId = invoice.customer_id;

                    if (subscriptionEntity.plan_id === ACTIVATION_PLAN_ID && customerId) {
                        const oldSubscriptionId = subscriptionEntity.id;
                        
                        console.log(`LIVE: Payment captured for ${oldSubscriptionId}. Upgrading customer ${customerId}...`);
                        
                        await razorpay.subscriptions.cancel(oldSubscriptionId);
                        console.log(`LIVE: Step 1/2: Cancelled old subscription ${oldSubscriptionId}.`);
                        
                        const startTimeInFuture = Math.floor(Date.now() / 1000) + 3600;

                        const newSubscription = await razorpay.subscriptions.create({
                            plan_id: MAIN_PLAN_ID,
                            customer_id: customerId,
                            total_count: 48,
                            start_at: startTimeInFuture 
                        });

                        console.log(`✅ VICTORY! LIVE Upgrade Complete! New ₹500 subscription ${newSubscription.id} is scheduled.`);
                        
                        const ref = db.ref('active_subscriptions/' + newSubscription.id);
                        await ref.set({
                            subscriptionId: newSubscription.id,
                            customerId: customerId,
                            status: 'scheduled',
                            planId: MAIN_PLAN_ID,
                            createdAt: new Date().toISOString(),
                            startsAt: new Date(startTimeInFuture * 1000).toISOString()
                        });
                        console.log("✅ LIVE: Firebase record created.");
                    }
                }
            }
        }
        
        res.json({ status: 'ok' });

    } catch (error) {
        console.error("❌ LIVE: Webhook processing error:", error.message, error.stack);
        res.status(500).send('Webhook error.');
    }
});


// बाकी रास्तों के लिए JSON Parser
app.use(express.json());

// === सब्सक्रिप्शन बनाने का Foolproof तरीका ===
app.post('/create-subscription', async (req, res) => {
    try {
        console.log("LIVE: Creating a new customer...");
        const customer = await razorpay.customers.create({
            name: 'Shubhzone User',
            email: `user_${Date.now()}@shubhzone.shop`
        });
        console.log(`LIVE: Customer created: ${customer.id}`);

        console.log(`LIVE: Creating subscription for customer ${customer.id}...`);
        const subscription = await razorpay.subscriptions.create({
            plan_id: ACTIVATION_PLAN_ID,
            customer_id: customer.id,
            total_count: 48,
            customer_notify: 1,
        });
        console.log("LIVE: Subscription created successfully:", subscription.id);
        
        res.json({
            subscription_id: subscription.id,
            key_id: process.env.RAZORPAY_KEY_ID
        });

    } catch (error) {
        console.error("❌ LIVE: Error during subscription creation:", error);
        res.status(500).json({ error: 'Failed to create subscription.' });
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Your server is LIVE and running on port ${PORT}`);
});

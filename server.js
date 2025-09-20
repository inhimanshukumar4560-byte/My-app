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
// अब हमें ₹5 के प्लान की ज़रूरत नहीं है!
const MAIN_PLAN_ID = 'plan_RJY2rfogWKazn1'; // सिर्फ ₹500 वाली Test Plan ID

// =========================================================================
// ==================== सब्सक्रिप्शन बनाने का नया और सही तरीका =================
// =========================================================================
app.post('/create-subscription', express.json(), async (req, res) => {
    try {
        console.log("Creating a new customer on Razorpay...");
        const customer = await razorpay.customers.create({
            name: 'Shubhzone User',
            email: `user_${Date.now()}@shubhzone.shop`
        });
        console.log(`✅ Customer created successfully: ${customer.id}`);

        // अभी से ठीक 1 घंटे बाद का समय निकालना (3600 सेकंड)
        const startTimeInFuture = Math.floor(Date.now() / 1000) + 3600;

        console.log(`Creating a ₹500 subscription for customer ${customer.id} with a ₹5 activation fee...`);
        
        const subscription = await razorpay.subscriptions.create({
            plan_id: MAIN_PLAN_ID, // हम सीधे ₹500 का प्लान बना रहे हैं
            customer_id: customer.id,
            total_count: 48,
            start_at: startTimeInFuture, // पहला ₹500 का चार्ज 1 घंटे बाद होगा
            addons: [ // --- यही है असली जादू ---
                {
                    item: {
                        name: "Activation Fee",
                        amount: 500, // 500 पैसे = ₹5
                        currency: "INR"
                    }
                }
            ],
            customer_notify: 1,
        });
        
        console.log("✅ Subscription created successfully:", subscription.id);
        
        res.json({
            subscription_id: subscription.id,
            key_id: process.env.RAZORPAY_KEY_ID
        });

    } catch (error) {
        console.error("❌ Error during smart subscription creation:", error);
        res.status(500).json({ error: 'Failed to create subscription.' });
    }
});


// WEBHOOK का रास्ता (असुरक्षित मोड में, सिर्फ टेस्टिंग के लिए)
app.post('/webhook', express.json(), async (req, res) => {
    console.log("--- [चेतावनी: असुरक्षित मोड] ---");
    console.log("वेबहुक मिला। सिग्नेचर की जाँच नहीं की जा रही है।");

    try {
        const body = req.body;
        console.log('वेबहुक का इवेंट:', body.event);
        
        // अब हमें सिर्फ यह रिकॉर्ड करना है कि सब्सक्रिप्शन शुरू हो गया है
        if (body.event === 'subscription.activated' || (body.event === 'payment.captured' && body.payload.payment.entity.invoice_id)) {
            
            let subscriptionId, customerId;

            if(body.event === 'subscription.activated') {
                subscriptionId = body.payload.subscription.entity.id;
                customerId = body.payload.subscription.entity.customer_id;
            } else {
                 const invoice = await razorpay.invoices.fetch(body.payload.payment.entity.invoice_id);
                 if (invoice.subscription_id) {
                    subscriptionId = invoice.subscription_id;
                    customerId = invoice.customer_id;
                 }
            }

            if(subscriptionId && customerId) {
                console.log(`✅ VICTORY! Subscription ${subscriptionId} for customer ${customerId} is now active.`);
                
                const ref = db.ref('active_subscriptions/' a+ subscriptionId);
                await ref.set({
                    subscriptionId: subscriptionId,
                    customerId: customerId,
                    status: 'active',
                    planId: MAIN_PLAN_ID,
                    createdAt: new Date().toISOString()
                });
                console.log("✅✅✅ Firebase record created.");
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
    console.log(`🚀 सर्वर पोर्ट ${PORT} पर लाइव है (स्मार्ट मोड में)।`);
});

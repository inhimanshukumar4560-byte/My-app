// ज़रूरी लाइब्रेरीज को इम्पोर्ट करना
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const admin = require('firebase-admin'); // Firebase Admin SDK
require('dotenv').config();

// --- Firebase Admin SDK का सेटअप (आपके तरीके के अनुसार) ---
// एनवायरनमेंट वेरिएबल से JSON स्ट्रिंग को पढ़ना
const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

// JSON स्ट्रिंग को पार्स करके ऑब्जेक्ट बनाना
const serviceAccount = JSON.parse(serviceAccountString);

// Firebase को शुरू करना
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://conceptra-c1000-default-rtdb.firebaseio.com" // आपके प्रोजेक्ट का URL
});

const db = admin.database();
// =======================================================

// Express ऐप बनाना
const app = express();

// CORS कॉन्फ़िगरेशन
app.use(cors());

// Middleware का इस्तेमाल करना
app.use(express.json());

// Razorpay इंस्टैंस बनाना
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// --- API ENDPOINTS ---

// eMandate (ऑटोपे) बनाने के लिए सही Endpoint (इसमें कोई बदलाव नहीं)
app.post('/create-subscription', async (req, res) => {
    try {
        const plan_id = "plan_RIgEghN6aicmgB";

        const subscriptionOptions = {
            plan_id: plan_id,
            total_count: 48,
            quantity: 1,
            customer_notify: 1,
        };

        const subscription = await razorpay.subscriptions.create(subscriptionOptions);
        console.log('Subscription created successfully:', subscription.id);

        res.json({
            subscription_id: subscription.id,
            key_id: process.env.RAZORPAY_KEY_ID
        });

    } catch (error) {
        console.error('Error creating Razorpay subscription:', error);
        res.status(500).json({ error: 'Something went wrong while creating the subscription.' });
    }
});

// Webhook सुनने के लिए Endpoint (इसमें Firebase का लॉजिक जोड़ा गया है)
app.post('/webhook', (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];

    console.log('Webhook received...');
    
    try {
        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(JSON.stringify(req.body));
        const digest = shasum.digest('hex');

        if (digest === signature) {
            console.log('Webhook verified successfully.');
            
            const event = req.body.event;
            const payload = req.body.payload;
            
            console.log('EVENT RECEIVED:', event);

            if (event === 'subscription.activated') {
                console.log('SUBSCRIPTION ACTIVATED! Saving to Firebase...');
                const subscriptionEntity = payload.subscription.entity;
                
                const subscriptionData = {
                    subscriptionId: subscriptionEntity.id,
                    customerId: subscriptionEntity.customer_id,
                    status: subscriptionEntity.status,
                    activatedAt: new Date().toISOString(),
                    planId: subscriptionEntity.plan_id,
                    totalCount: subscriptionEntity.total_count,
                    lastCharged: null
                };
                
                const ref = db.ref('active_subscriptions/' + subscriptionEntity.id);
                ref.set(subscriptionData)
                    .then(() => console.log('Successfully saved to Firebase:', subscriptionEntity.id))
                    .catch(err => console.error('Error saving to Firebase:', err));
            }

             if (event === 'payment.captured') {
                console.log('INITIAL PAYMENT CAPTURED!');
                console.log('Payment ID:', payload.payment.entity.id);
                console.log('Amount:', payload.payment.entity.amount / 100, 'INR');
            }

            res.json({ status: 'ok' });

        } else {
            console.warn('Webhook verification failed.');
            res.status(400).json({ error: 'Invalid signature.' });
        }
    } catch (error)
    {
        console.error('Error processing webhook:', error);
        res.status(500).send('Internal Server Error');
    }
});

// एडमिन पैनल से चार्ज करने के लिए नया एंडपॉइंट
app.post('/api/charge-addon', async (req, res) => {
    const { subscription_id, amount } = req.body;

    if (!subscription_id || !amount) {
        return res.status(400).json({ error: 'Subscription ID and amount are required.' });
    }

    try {
        console.log(`Creating add-on for Sub ID: ${subscription_id} with Amount: ${amount}`);

        const addonData = {
            item: {
                name: "On-demand Service Charge",
                amount: amount * 100, // राशि को पैसे में बदलना (₹500 = 50000 पैसे)
                currency: "INR"
            }
        };

        const addon = await razorpay.subscriptions.createAddon(subscription_id, addonData);

        console.log('Add-on created successfully:', addon);
        res.json({ success: true, addon_id: addon.id, message: 'Add-on created. Will be charged in the next cycle.' });

    } catch (error) {
        console.error('Error creating add-on:', error.error ? error.error.description : error.message);
        res.status(500).json({ error: 'Failed to create add-on. ' + (error.error ? error.error.description : 'Please check server logs.') });
    }
});

// सर्वर को स्टार्ट करना
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Backend server is running on port ${PORT}`);
});

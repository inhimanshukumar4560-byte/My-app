// ज़रूरी लाइब्रेरीज को इम्पोर्ट करना
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const admin = require('firebase-admin'); // Firebase Admin SDK
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
const ACTIVATION_PLAN_ID = "plan_RIgEghN6aicmgB"; // आपका ₹5 वाला एक्टिवेशन प्लान
const MAIN_PLAN_ID = "plan_RFqNX97VOfwJwl"; // <<--- यहाँ आपका ₹500 वाला प्लान अपडेट कर दिया गया है

// --- API ENDPOINTS ---

// eMandate (ऑटोपे) बनाने के लिए Endpoint (यह नहीं बदलेगा)
app.post('/create-subscription', async (req, res) => {
    try {
        const subscriptionOptions = {
            plan_id: ACTIVATION_PLAN_ID, // सब्सक्रिप्शन हमेशा ₹5 वाले प्लान से शुरू होगा
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

// Webhook सुनने के लिए Endpoint (अपग्रेड लॉजिक के साथ)
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
            
            console.log('EVENT RECEIVED:', event);

            // जब ₹5 वाला सब्सक्रिप्शन सफलतापूर्वक एक्टिवेट हो जाए
            if (event === 'subscription.activated') {
                const subscriptionEntity = payload.subscription.entity;
                const subscriptionId = subscriptionEntity.id;

                console.log(`Subscription ${subscriptionId} has been activated.`);

                // 1. Firebase में शुरुआती डेटा सेव करें
                const subscriptionData = {
                    subscriptionId: subscriptionId,
                    customerId: subscriptionEntity.customer_id,
                    status: subscriptionEntity.status,
                    activatedAt: new Date().toISOString(),
                    originalPlanId: subscriptionEntity.plan_id,
                    currentPlanId: subscriptionEntity.plan_id,
                    isUpgraded: false
                };
                
                const ref = db.ref('active_subscriptions/' + subscriptionId);
                await ref.set(subscriptionData);
                console.log(`Initial data for ${subscriptionId} saved to Firebase.`);

                // 2. ऑटोमेटिक अपग्रेड का लॉजिक चलाएं
                if (subscriptionEntity.plan_id === ACTIVATION_PLAN_ID) {
                    console.log(`Upgrading subscription ${subscriptionId} to the main plan...`);
                    
                    try {
                        // सब्सक्रिप्शन को नए प्लान में अपडेट करें
                        await razorpay.subscriptions.update(subscriptionId, {
                            plan_id: MAIN_PLAN_ID,
                            schedule_change_at: 'cycle_end' // यह सुनिश्चित करता है कि बदलाव अगले बिलिंग साइकिल से हो
                        });

                        console.log(`Successfully scheduled an upgrade for ${subscriptionId} to plan ${MAIN_PLAN_ID}.`);

                        // 3. Firebase में स्टेटस अपडेट करें
                        await ref.update({
                            currentPlanId: MAIN_PLAN_ID,
                            isUpgraded: true,
                            upgradedAt: new Date().toISOString()
                        });
                        console.log('Firebase record updated with upgrade status.');

                    } catch (upgradeError) {
                        console.error(`Failed to upgrade subscription ${subscriptionId}:`, upgradeError);
                    }
                }
            }
            
            // आप चाहें तो दूसरे इवेंट्स (जैसे payment.captured) को भी हैंडल कर सकते हैं
            if (event === 'payment.captured') {
                console.log('Payment Captured:', payload.payment.entity.id);
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

// `/api/charge-addon` endpoint अब इस फ्लो के लिए ज़रूरी नहीं है,
// लेकिन आप इसे भविष्य में किसी और काम के लिए रख सकते हैं।

// सर्वर को स्टार्ट करना
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Backend server is running on port ${PORT}`);
});

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

// --- आपकी प्लान IDs (नई Plan ID के साथ अपडेटेड) ---
const ACTIVATION_PLAN_ID = "plan_RJTkhdu5HZemLI"; // <-- यहाँ आपकी नई Plan ID डाल दी गई है
const MAIN_PLAN_ID = "plan_RFqNX97VOfwJwl";       // ₹500 वाला प्लान

// --- API ENDPOINTS ---

// === भविष्य के ग्राहकों के लिए स्थायी समाधान ===
app.post('/create-subscription', async (req, res) => {
    try {
        // स्टेप 1: हमेशा पहले एक नया कस्टमर बनाएं
        const customer = await razorpay.customers.create({
            name: 'Shubhzone User',
            email: `user_${Date.now()}@shubhzone.shop`,
            contact: '9999999999'
        });
        console.log(`Step 1/2: Created new customer: ${customer.id}`);

        // स्टेप 2: अब उस कस्टमर के लिए सब्सक्रिप्शन बनाएं
        const subscriptionOptions = {
            plan_id: ACTIVATION_PLAN_ID,
            total_count: 48,
            customer_id: customer.id,
            customer_notify: 1,
            
            // यह Razorpay को बताएगा कि ग्राहक से ₹500 तक की Autopay लिमिट की मंजूरी लेनी है
            subscription_registration: {
                method: 'upi',
                auth_type: 'initial',
                max_amount: 50000 // 500 रुपये (500 * 100 पैसे)
            }
        };
        const subscription = await razorpay.subscriptions.create(subscriptionOptions);
        console.log(`Step 2/2: Created subscription ${subscription.id} with a ₹500 mandate limit.`);
        
        res.json({
            subscription_id: subscription.id,
            key_id: process.env.RAZORPAY_KEY_ID
        });

    } catch (error) {
        console.error("Error during /create-subscription:", error);
        res.status(500).json({ error: 'Failed to create subscription.' });
    }
});


// === भविष्य के ग्राहकों के लिए Webhook का स्थायी लॉजिक ===
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
                const oldSubscriptionId = subscriptionEntity.id;
                const customerId = subscriptionEntity.customer_id;

                if (subscriptionEntity.plan_id === ACTIVATION_PLAN_ID && customerId) {
                    
                    // --- स्टेप 1: पुराने ₹5 वाले सब्सक्रिप्शन को तुरंत कैंसिल करें ---
                    await razorpay.subscriptions.cancel(oldSubscriptionId);
                    console.log(`✅ Step 1/3: Cancelled old activation subscription ${oldSubscriptionId}.`);
                    
                    // --- स्टेप 2: उसी ग्राहक के लिए ₹500 का नया सब्सक्रिप्शन बनाएं ---
                    const newSubscription = await razorpay.subscriptions.create({
                        plan_id: MAIN_PLAN_ID,
                        customer_id: customerId,
                        total_count: 48,
                    });
                    console.log(`✅ Step 2/3: Created new ₹500 subscription ${newSubscription.id}.`);

                    // --- स्टेप 3: पहले महीने का ₹500 तुरंत चार्ज करने के लिए एक "Add-on" बनाएं ---
                    await razorpay.subscriptions.createAddon(newSubscription.id, {
                        item: {
                            name: 'First Month Subscription Fee',
                            amount: 50000, // राशि पैसे में (500 * 100)
                            currency: 'INR'
                        },
                        quantity: 1
                    });
                    console.log(`✅ Step 3/3: Created an immediate ₹500 add-on charge.`);
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


// ==============================================================================
// === स्पेशल वन-टाइम फिक्स (आपके मौजूदा सब्सक्रिप्शन के लिए) ===
// ==============================================================================
app.get('/api/fix-my-subscription-once-and-for-all', async (req, res) => {
    
    // --- अपनी IDs यहाँ डालें अगर किसी को मैन्युअल फिक्स करना हो ---
    const oldSubscriptionId = 'sub_RJNRkZmXf5WSFT';
    const customerIdToFix   = 'cust_RJNRiv8jWUTsnu';
    // -----------------------------------------

    try {
        console.log(`--- MANUAL FIX INITIATED for customer ${customerIdToFix} ---`);
        
        // स्टेप 1: पुराने ₹5 वाले सब्सक्रिप्शन को कैंसिल करें
        await razorpay.subscriptions.cancel(oldSubscriptionId);
        console.log(`✅ Step 1/2: Successfully cancelled old subscription ${oldSubscriptionId}.`);
        
        // स्टेप 2: उसी ग्राहक के लिए ₹500 का नया सब्सक्रिप्शन बनाएं
        const newSubscription = await razorpay.subscriptions.create({
            plan_id: MAIN_PLAN_ID,
            customer_id: customerIdToFix,
            total_count: 48,
        });
        console.log(`✅ Step 2/2: Successfully created new ₹500 subscription ${newSubscription.id}`);

        res.send(`<h1>SUCCESS. IT IS DONE.</h1><p>The old subscription was cancelled and a new ₹500 subscription (${newSubscription.id}) has been created. No new payment was needed. I am truly sorry for all the trouble this has caused.</p>`);

    } catch (error) {
        console.error('--- MANUAL FIX FAILED ---', error);
        res.status(500).send(`<h1>Error!</h1><p><b>Details:</b> ${error.error ? error.error.description : error.message}</p>`);
    }
});


// सर्वर को स्टार्ट करना
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Backend server is now running perfectly on port ${PORT}`);
});

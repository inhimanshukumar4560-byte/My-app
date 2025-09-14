// ज़रूरी लाइब्रेरीज को इम्पोर्ट करना
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config(); // यह लोकल टेस्टिंग के लिए एनवायरनमेंट वेरिएबल्स लोड करता है

// Express ऐप बनाना
const app = express();

// Middleware का इस्तेमाल करना
app.use(cors()); // CORS समस्याओं से बचने के लिए
app.use(express.json()); // JSON रिक्वेस्ट बॉडी को समझने के लिए

// Razorpay इंस्टैंस बनाना (API Keys का इस्तेमाल करके)
// यह सुनिश्चित करें कि आपने Render के Environment Variables में यह सब डाल दिया है
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// --- API ENDPOINTS ---

// 1. सब्सक्रिप्शन बनाने के लिए Endpoint
// आपका फ्रंटएंड '/api/create-subscription' पर रिक्वेस्ट भेजेगा
app.post('/create-subscription', async (req, res) => {
    try {
        const planId = process.env.RAZORPAY_PLAN_ID; // Render के Environment से Plan ID लेना

        if (!planId) {
            return res.status(500).json({ error: 'Razorpay Plan ID not configured.' });
        }

        console.log(`Creating subscription with Plan ID: ${planId}`);

        const options = {
            plan_id: planId,
            total_count: 120, // यह मैंडेट को 10 साल तक (120 महीने) के लिए वैलिड बनाता है, ताकि आप कभी भी चार्ज कर सकें
            quantity: 1,
            customer_notify: 1, // ग्राहक को सूचना भेजें
        };

        const subscription = await razorpay.subscriptions.create(options);

        console.log('Subscription created successfully:', subscription.id);

        // फ्रंटएंड को subscription_id और key_id भेजना
        res.json({
            subscription_id: subscription.id,
            key_id: process.env.RAZORPAY_KEY_ID 
        });

    } catch (error) {
        console.error('Error creating Razorpay subscription:', error);
        res.status(500).json({ error: 'Something went wrong with the payment gateway.' });
    }
});


// 2. Webhook सुनने के लिए Endpoint
// Razorpay इस '/webhook' Endpoint पर पेमेंट की जानकारी भेजेगा
app.post('/webhook', (req, res) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];

    console.log('Webhook received...');
    
    try {
        // Razorpay से आए हुए मैसेज की प्रामाणिकता की जाँच करना
        const shasum = crypto.createHmac('sha256', secret);
        shasum.update(JSON.stringify(req.body));
        const digest = shasum.digest('hex');

        if (digest === signature) {
            // सिग्नेचर सही है, अब आगे का काम करें
            console.log('Webhook verified successfully.');
            
            const event = req.body.event;
            const payload = req.body.payload;

            // यहाँ आप अलग-अलग इवेंट्स को हैंडल कर सकते हैं
            if (event === 'subscription.activated') {
                console.log('SUBSCRIPTION ACTIVATED!');
                console.log('Subscription ID:', payload.subscription.entity.id);
                console.log('Plan ID:', payload.subscription.entity.plan_id);
            }
             if (event === 'subscription.charged') {
                console.log('SUBSCRIPTION CHARGED!');
                console.log('Payment ID:', payload.payment.entity.id);
                 console.log('Amount:', payload.payment.entity.amount / 100, 'INR');
            }

            // Razorpay को बताना कि हमें मैसेज मिल गया
            res.json({ status: 'ok' });

        } else {
            // सिग्नेचर गलत है
            console.warn('Webhook verification failed.');
            res.status(400).json({ error: 'Invalid signature.' });
        }
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).send('Internal Server Error');
    }
});


// सर्वर को स्टार्ट करना
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend server is running on port ${PORT}`);
});

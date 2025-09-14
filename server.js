// ज़रूरी लाइब्रेरीज को इम्पोर्ट करना
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config(); // यह लोकल टेस्टिंग के लिए एनवायरनमेंट वेरिएबल्स लोड करता है

// Express ऐप बनाना
const app = express();

// CORS कॉन्फ़िगरेशन (यह सभी वेबसाइटों से आने वाली रिक्वेस्ट को अनुमति देता है, जो Netlify प्रॉक्सी के लिए ज़रूरी है)
app.use(cors());

// Middleware का इस्तेमाल करना
app.use(express.json()); // JSON रिक्वेस्ट बॉडी को समझने के लिए

// Razorpay इंस्टैंस बनाना (API Keys का इस्तेमाल करके)
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// --- API ENDPOINTS ---

// eMandate (ऑटोपे) बनाने के लिए Endpoint
// === यहाँ सबसे ज़रूरी बदलाव किया गया है ===
// Netlify के नियम के अनुसार, हमने यहाँ से '/api' हटा दिया है।
// अब यह सीधे Netlify से आने वाली रिक्वेस्ट को स्वीकार करेगा।
app.post('/create-mandate-order', async (req, res) => {
    try {
        // चरण 1: एक नया ग्राहक बनाना
        const customerOptions = {
            name: 'Shubhzone User',
            email: `user_${Date.now()}@shubhzone.shop`, // हर बार एक यूनिक ईमेल बनाएं
            contact: '9999999999'
        };
        const customer = await razorpay.customers.create(customerOptions);
        console.log('Customer created successfully:', customer.id);

        // चरण 2: ₹2 का एक शुरुआती ऑर्डर बनाना ताकि मैंडेट सक्रिय हो सके
        const orderOptions = {
            amount: 200, // राशि हमेशा पैसे में होती है (₹2 = 200 पैसे)
            currency: 'INR',
            receipt: `receipt_order_${Date.now()}`,
            payment: {
                capture: 'automatic',
                capture_options: {
                    automatic_expiry_period: 12, // 12 मिनट में पेमेंट कैप्चर करें
                    manual_expiry_period: 720, // 12 घंटे का मैनुअल कैप्चर पीरियड
                    refund_speed: 'normal'
                }
            }
        };

        const order = await razorpay.orders.create(orderOptions);
        console.log('Order for mandate created successfully:', order.id);

        // फ्रंटएंड को order_id, customer_id और key_id भेजना
        res.json({
            order_id: order.id,
            customer_id: customer.id,
            key_id: process.env.RAZORPAY_KEY_ID
        });

    } catch (error) {
        console.error('Error creating Razorpay mandate order:', error);
        res.status(500).json({ error: 'Something went wrong with the payment gateway.' });
    }
});


// Webhook सुनने के लिए Endpoint (इसमें कोई बदलाव नहीं किया गया है, यह पहले से ही सही है)
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
            
            console.log('EVENT RECEIVED:', event);

            if (event === 'mandate.activated') {
                console.log('MANDATE ACTIVATED! You can now charge this customer.');
                console.log('Mandate ID:', payload.mandate.entity.id);
                console.log('Payment ID for activation:', payload.mandate.entity.payment_method.initial_payment_id);
            }
             if (event === 'payment.captured') {
                console.log('PAYMENT CAPTURED!');
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
    } catch (error)
    {
        console.error('Error processing webhook:', error);
        res.status(500).send('Internal Server Error');
    }
});


// सर्वर को स्टार्ट करना
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Backend server is running on port ${PORT}`);
});

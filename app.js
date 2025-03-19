require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors =require('cors')
const { PrismaClient } = require("@prisma/client");
const nodemailer = require("nodemailer");
const app = express();
app.use(cors());
app.use(express.json());
const path = require("path");
const prisma = new PrismaClient();
const { body, validationResult } = require("express-validator");
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
const generateVerificationCode = () => {
  return Math.floor(1000 + Math.random() * 9000);
};
const sendConfirmationEmail = async (email, verificationCode) => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Welcome to Abeer - Email Verification",
      text: `Hi there,
      
      Thank you for joining Abeer!! 🎉
      
      We are excited to have you with us. To complete your registration and verify your email address, please use the following verification code:
      
      🔑 Verification Code: ${verificationCode}
      
Simply copy and paste the code into the verification form to activate your account.

If you didn’t sign up for Aber, please disregard this email.

We’re here to help if you need any assistance. Feel free to reach out to our support team.

Warm regards,  
The Aber Team  
🚀 Your journey starts here!`,
    };
    require("dotenv").config();
    await transporter.sendMail(mailOptions);
    console.log("Confirmation email sent successfully");
  } catch (error) {
    console.error("Error sending confirmation email:", error);
  }
};
// <-------payment------->
const PAYMOB_API_KEY = process.env.PAYMOB_API_KEY;
const PAYMOB_INTEGRATION_ID = process.env.PAYMOB_INTEGRATION_ID;
const PAYMOB_MERCHANT_ID = process.env.PAYMOB_MERCHANT_ID;
const PAYMOB_BASE_URL = process.env.PAYMOB_BASE_URL;
const PAYMOB_IFRAME_ID = process.env.PAYMOB_IFRAME_ID;

async function authenticate() {
  try {
    const response = await axios.post(`${PAYMOB_BASE_URL}/auth/tokens`, {
      api_key: PAYMOB_API_KEY,
    });
    return response.data.token;
  } catch (error) {
    console.error(
      "Authentication failed:",
      error.response?.data || error.message
    );
    throw error;
  }
}
async function createOrder(
  token,
  amount,
  currency,
  items,
) {
  try {
    const response = await axios.post(
      `${PAYMOB_BASE_URL}/ecommerce/orders`,
      {
        auth_token: token,
        delivery_needed: "false",
        amount_cents: amount * 100, // amount in cents (e.g., 500 SAR = 50000)
        currency: currency,
        items,
        merchant_order_ext_ref: 'order' + Date.now() // unique order reference
      }
    );

    if (response.status === 201) {
      // console.log('Payment Order Created:', response.data);
      return response.data;
    } else {
      console.error('Failed to create payment order:', response.data);
    }
 // Paymob's order ID
  } catch (error) {
    console.error(
      "Order creation failed:",
      error.response?.data || error.message
    );
    throw error;
  }
}
async function generatePaymentKey(
  token,
  orderId,
  amount,
  currency,
  integrationId,
  billingData
) {
  try {
    const response = await axios.post(
      `${PAYMOB_BASE_URL}/acceptance/payment_keys`,
      {
        auth_token: token,
        amount_cents: amount * 100,
        expiration: 3600, // Key expiration time in seconds
        order_id: orderId,
        billing_data: billingData,
        currency,
        integration_id: integrationId, // Your PAYMOB_INTEGRATION_ID
      }
    );
    return response.data.token; // Payment key
  } catch (error) {
    console.error(
      "Payment key generation failed:",
      error.response?.data || error.message
    );
    throw error;
  }
}
const { ObjectId } = require("mongodb"); // تأكد من إضافة هذا السطر

app.post("/payment", async (req, res) => {
  try {
    const { amount, currency, items, billing_data, orders, name } = req.body;

    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ error: "Orders must be an array with at least one order" });
    }

    // Step 1: Authenticate
    const token = await authenticate();
    console.log("✅ Auth Token:", token);

    // Step 2: Create an order
    const orderResponse = await createOrder(token, amount, currency, items);
    console.log("✅ Order Response:", orderResponse);

    // Step 3: Generate payment key
    const paymentKey = await generatePaymentKey(
      token,
      orderResponse.id,
      amount,
      currency,
      PAYMOB_INTEGRATION_ID,
      billing_data
    );

    // Step 4: Generate payment link
    const paymentLink = `${PAYMOB_BASE_URL}/acceptance/iframes/${PAYMOB_IFRAME_ID}?payment_token=${paymentKey}`;

    // Step 5: Store the payment in the database
    let newPayment;
    try {
      newPayment = await prisma.payment.create({
        data: {
          name: name || "Unknown",
          amount,
          currency,
          orderCount: orders.length,
          orders,
          orderId: new ObjectId(orderResponse.id).toString(),
        },
      });
      console.log("✅ Payment Stored in DB:", newPayment);
    } catch (dbError) {
      console.error("❌ Database Storage Error:", dbError);
      return res.status(500).json({ error: "Database error", details: dbError.message });
    }

    // Step 6: Return response
    res.status(200).json({
      paymentId: newPayment.id, // استخراج معرف الدفع
      paymentLink,
      orderCount: orders.length,
      orders,
    });

  } catch (error) {
    console.error("❌ Error creating payment:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
});
app.get("/payment/callback", (req, res) => {
  const { success, id } = req.query;

  if (success === "true") {
    // Handle successful payment (e.g., mark the order as paid)
    console.log("Payment succeeded. Transaction ID:", id);
    res.send("Payment Successful");
  } else {
    // Handle failed payment
    console.error("Payment failed. Transaction ID:", id);
    res.send("Payment Failed");
  }
});
// <------endPayment------>
// <-------notification------>
app.post("/notifications", async (req, res) => {
  try {
    const { userId, message, type } = req.body;

    if (!userId || !message || !type) {
      return res
        .status(400)
        .json({ error: "UserId, message, and type are required." });
    }

    const newNotification = await prisma.notification.create({
      data: {
        userId,
        message,
        type,
      },
    });

    res.status(201).json({ notification: newNotification });
  } catch (error) {
    console.error("❌ ERROR in POST /notifications:", error);
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});
app.get("/notifications/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: {
        createdAt: "desc", // Ascending order based on createdAt
      },
    });

    if (notifications.length === 0) {
      return res
        .status(404)
        .json({ error: "No notifications found for this user." });
    }

    res.status(200).json({ notifications });
  } catch (error) {
    console.error("❌ ERROR in GET /notifications:", error);
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});
app.delete("/notifications/:userId/:notificationId", async (req, res) => {
  try {
    const { userId, notificationId } = req.params;

    const notification = await prisma.notification.deleteMany({
      where: {
        id: notificationId,
        userId: userId,
      },
    });

    if (notification.count === 0) {
      return res
        .status(404)
        .json({ error: "Notification not found or user mismatch." });
    }

    res.status(200).json({ message: "Notification deleted successfully." });
  } catch (error) {
    console.error("❌ ERROR in DELETE /notifications:", error);
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});
// <-------endNotification------>
// <--------------car-------->
const multer = require("multer");
app.use(express.urlencoded({ extended: true })); // لاستقبال بيانات form-url-encoded
app.use(express.json()); // لاستقبال بيانات JSON

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // تحديد مسار حفظ الملفات
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname); // إعادة تسمية الملف
  },
});
const upload = multer({ storage: storage });
app.post("/create-car",
  upload.fields([
    { name: "images", maxCount: 5 }, // استقبال حتى 5 صور
    { name: "documents", maxCount: 5 }, // استقبال حتى 5 مستندات
  ]),
  async (req, res) => {
    const {
      carName,
      ownerName,
      email,
      phone,
      address,
      password,
      description,
      userId,
      pushToken, // 🔹 إضافة pushToken إلى البيانات المستقبلة
    } = req.body;

    try {
      let finalUserId = userId;
      let newUser = null;

      if (!userId) {
        newUser = await prisma.user.create({
          data: {
            name: ownerName,
            email,
            password,
            phone,
            address,
            pushToken, // 🔹 إضافة pushToken عند إنشاء المستخدم
          },
        });
        finalUserId = newUser.id;
      } else {
        const existingUser = await prisma.user.findUnique({
          where: { id: userId },
        });
        if (!existingUser) {
          return res.status(404).json({ error: "User not found" });
        }
      }

      const imagePaths = req.files["images"]
        ? req.files["images"].map((file) => file.path)
        : [];
      const documentPaths = req.files["documents"]
        ? req.files["documents"].map((file) => file.path)
        : [];

      const newCar = await prisma.car.create({
        data: {
          name: carName,
          description,
          ownerName,
          email,
          phone,
          address,
          imagePaths,
          documentPaths,
          ownerId: finalUserId,
        },
        include: {
          owner: true,
        },
      });

      res.status(201).json({
        message: "Car created successfully.",
        car: newCar,
        owner: newUser ? { ...newUser, password: undefined } : undefined,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);
app.put("/update-car",
  upload.fields([
    { name: "imagePaths", maxCount: 5 },
    { name: "documentPaths", maxCount: 5 },
  ]),
  async (req, res) => {
    const { userId, carName, ownerName, email, phone, address } = req.body;

    // الحصول على الصور والمستندات
    const imagePaths = req.files["imagePaths"] || [];
    const documentPaths = req.files["documentPaths"] || [];

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    try {
      const cars = await prisma.car.findMany({
        where: { ownerId: userId },
      });

      if (cars.length === 0) {
        return res.status(404).json({ error: "No cars found for the given user ID" });
      }

      const updatedCars = await prisma.car.updateMany({
        where: { ownerId: userId },
        data: {
          name: carName || undefined,
          ownerName: ownerName || undefined,
          email: email || undefined,
          phone: phone || undefined,
          address: address || undefined,
          imagePaths: imagePaths.length ? imagePaths.map((file) => file.path) : undefined,
          documentPaths: documentPaths.length ? documentPaths.map((file) => file.path) : undefined,
        },
      });

      res.status(200).json({
        message: "Cars updated successfully.",
        cars: updatedCars,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);
app.get("/get-car-by-user/:userId", async (req, res) => {
  const { userId } = req.params; // User ID to fetch cars for
  // Check if the user ID is provided
  if (!userId) {
    return res.status(400).json({ error: "User ID is required" });
  }

  try {
    // Find cars associated with the user by ownerId
    const cars = await prisma.car.findMany({
      where: {
        ownerId: userId, // Use ownerId instead of userId
      },
    });

    // If no cars found, return an error
    if (cars.length === 0) {
      return res.status(404).json({ error: "No cars found for this user" });
    }

    // Respond with the cars associated with the user
    res.status(200).json({
      message: "Cars fetched successfully.",
      cars: cars,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/car-details/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Fetch car details for the given user
    const car = await prisma.car.findFirst({
      where: { ownerId: userId },
      select: {
        name: true,
        address: true,
        imagePaths: true,
      },
    });

    if (!car) {
      console.log("❌ No car found for userId:", userId);
      return res.status(404).json({ error: "No car found for this user." });
    }

    // Fetch location details for the user
    const location = await prisma.location.findFirst({
      where: { userId: userId },
      select: {
        longitude: true,
        latitude: true,
      },
    });

    if (!location) {
      console.log("❌ No location found for userId:", userId);
    }

    console.log("✅ Car found:", car);

    // Fetch orders with feedback for the user
    const orders = await prisma.order.findMany({
      where: { userId },
      select: {
        feedback: {
          select: {
            rating: true,
          },
        },
      },
    });

    // Calculate the average feedback rating
    let totalRating = 0;
    let feedbackCount = 0;

    orders.forEach((order) => {
      order.feedback.forEach((fb) => {
        totalRating += fb.rating;
        feedbackCount++;
      });
    });

    const averageRating =
      feedbackCount > 0 ? totalRating / feedbackCount : null;

    // Response formatting with location details
    res.status(200).json({
      carName: car.name,
      address: car.address,
      imagePaths: car.imagePaths,
      feedbackRate: averageRating,
      longitude: location?.longitude ?? null, // Location longitude
      latitude: location?.latitude ?? null, // Location latitude
    });
  } catch (error) {
    console.error("❌ ERROR in GET /car-details:", error);
    res
      .status(500)
      .json({ error: "Internal server  error", details: error.message });
  }
});
app.get("/get-all-cars", async (req, res) => {
  try {
    // Fetch all cars from the database
    const cars = await prisma.car.findMany();

    // If no cars found, return an appropriate response
    if (cars.length === 0) {
      return res.status(404).json({ error: "No cars found in the database." });
    }

    // Respond with the list of all cars
    res.status(200).json({
      message: "All cars fetched successfully.",
      cars: cars,
    });
  } catch (error) {
    console.error("Error fetching all cars:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// <------------endCars------->
// <-----------user------->
app.post("/get-password", async (req, res) => {
  try {
    const { phone, email } = req.body;

    // Validate input: Ensure either phone or email is provided
    if (!phone?.trim() || !email?.trim()) {
      return res.status(400).json({ error: "Both phone number and email are required" });
    }

    console.log(`🔍 Searching for user with phone: ${phone} and email: ${email}`);

    // Search for user by both phone and email
    const user = await prisma.user.findFirst({
      where: {
        phone: phone.trim(),
        email: email.trim(),
      },
      select: {
        id: true,
        password: true,
      },
    });

    if (user) {
      console.log("✅ User found:", user);
      return res.status(200).json(user);
    } else {
      console.log("❌ No matching user found");
      return res.status(404).json({ error: "No user found with the provided phone and email" });
    }

  } catch (error) {
    console.error("❌ ERROR in /get-password:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/registers", async (req, res) => {
  try {
    const { name, email, password, phone, pushToken } = req.body;

    console.log("✅ Received registration request");

    if (!name?.trim() || !email?.trim() || !password?.trim() || !phone?.trim()) {
      console.log("❌ Validation failed");
      return res
        .status(400)
        .json({ error: "Name, email, password, and phone number are required" });
    }

    console.log("🔍 Checking if user already exists...");
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      console.log("❌ Email already in use");
      return res.status(400).json({ error: "Email already in use" });
    }

    console.log("🔢 Generating verification code...");
    const verificationCode = generateVerificationCode();

    console.log("📝 Creating user in database...");
    const newUser = await prisma.user.create({
      data: {
        name: name.trim(),
        email: email.trim(),
        password,
        phone: phone.trim(),
        verificationCode,
        pushToken: pushToken || null, // إضافة الـ pushToken إذا كان متاحًا
      },
    });

    console.log("📧 Sending verification email...");
    await sendConfirmationEmail(email, verificationCode);

    console.log("✅ User registered successfully!");
    res.status(201).json({
      message: `Registration successful. A confirmation email has been sent with your verification code.`,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        verificationCode: newUser.verificationCode,
        pushToken: newUser.pushToken,
      },
    });
  } catch (error) {
    console.error("❌ ERROR in /registers:", error);
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});

app.post("/change-password", async (req, res) => {
  const { userId } = req.body;
  const { oldPassword, newPassword } = req.body;

  console.log("✅ Received change password request for user:", userId);

  // Validate input
  if (!oldPassword?.trim() || !newPassword?.trim()) {
    console.log("❌ Validation failed");
    return res
      .status(400)
      .json({ error: "Old password and new password are required" });
  }

  try {
    // Check if the user exists
    console.log("🔍 Checking if user exists...");
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      console.log("❌ User not found");
      return res.status(404).json({ error: "User not found" });
    }

    // Verify the old password
    console.log("🔐 Verifying old password...");
    if (user.password !== oldPassword) {
      console.log("❌ Old password is incorrect");
      return res.status(400).json({ error: "Old password is incorrect" });
    }

    // Update the password
    console.log("🔑 Updating password...");
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { password: newPassword.trim() },
    });

    console.log("✅ Password updated successfully!");
    res.status(200).json({
      message: "Password updated successfully.",
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
      },
    });
  } catch (error) {
    console.error("❌ ERROR in /change-password:", error);
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    // Find the user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Compare the entered password with the stored password (plaintext in this case)
    if (user.password !== password) {
      return res.status(401).json({ error: "Invalid password" });
    }

    // Respond with the user data (exclude password)
    const userResponse = { ...user, password: undefined };

    res.status(200).json({
      message: "Login successful",
      user: userResponse,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.put("/update-user/:userId", async (req, res) => {
  const { userId } = req.params; // Get the userId from the URL parameters
  const { name, email, phone, address, password, verificationCode } = req.body; // Get all possible fields

  try {
    // Find the user by userId
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Update only the fields that are provided in the request
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        name: name || existingUser.name, // If provided, use the new value; otherwise, keep the old value
        email: email || existingUser.email, // Same logic for email
        phone: phone || existingUser.phone,
        address: address || existingUser.address,
        password: password || existingUser.password,
        verificationCode: verificationCode || existingUser.verificationCode,
      },
    });

    res.status(200).json({
      message: "User updated successfully.",
      user: updatedUser,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/add-address", async (req, res) => {
  try {
    const { userId, address, latitude, longitude } = req.body;

    if (!userId || !address) {
      return res.status(400).json({ message: "User ID and address are required" });
    }

    // Check if user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Add new address
    const newAddress = await prisma.newAddress.create({
      data: { userId, address, latitude, longitude },
    });

    return res.status(201).json({
      message: "New address added successfully",
      newAddress,
    });
  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});
app.post("/add-address2", async (req, res) => {
  try {
    const { userId, tasnif, hay, address, flat, instruction } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Check if user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Add new address
    const newAddress2 = await prisma.newAddress2.create({
      data: { userId, tasnif, hay, address, flat, instruction },
    });

    return res.status(201).json({
      message: "New address added successfully",
      newAddress2,
    });
  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});
app.get("/get-address/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const addresses = await prisma.newAddress.findMany({ where: { userId } });

    return res.status(200).json(addresses);
  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});
app.get("/get-address2/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const addresses = await prisma.newAddress2.findMany({ where: { userId } });

    return res.status(200).json(addresses);
  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});
app.put("/update-address/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { address, latitude, longitude } = req.body;

    // Check if the address exists
    const existingAddress = await prisma.newAddress.findFirst({ where: { userId } });
    if (!existingAddress) {
      return res.status(404).json({ message: "Address not found for this user" });
    }

    const updatedAddress = await prisma.newAddress.updateMany({
      where: { userId },
      data: { address, latitude, longitude },
    });
    return res.status(200).json({ message: "Address updated successfully", updatedAddress });
  } 
    catch (error) {
    return res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});
app.put("/update-address2/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { tasnif, hay, address, flat, instruction } = req.body;

    // Check if the address exists
    const existingAddress2 = await prisma.newAddress2.findFirst({ where: { userId } });
    if (!existingAddress2) {
      return res.status(404).json({ message: "Address not found for this user" });
    }

    // Update the address
    const updatedAddress2 = await prisma.newAddress2.updateMany({
      where: { userId },
      data: { tasnif, hay, address, flat, instruction },
    });

    return res.status(200).json({ message: "Address updated successfully", updatedAddress2 });
  } catch (error) {
    return res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});
app.delete("/delete-user", async (req, res) => {
  try {
    const { userId, why } = req.body;

    console.log("🗑️ Received delete request");

    // Validate input
    if (!userId?.trim() || !why?.trim()) {
      console.log("❌ Validation failed");
      return res.status(400).json({ error: "User ID and reason (why) are required" });
    }

    console.log("🔍 Checking if user exists...");
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      console.log("❌ User not found");
      return res.status(404).json({ error: "User not found" });
    }

    // Store deletion reason in DeletedUsers table
    console.log("📝 Storing deletion reason...");
    await prisma.deletedUser.create({
      data: {
        userId: user.id,
        email: user.email,
        name: user.name,
        reason: why.trim(),
      },
    });

    // Delete the user
    console.log("🗑️ Deleting user from database...");
    await prisma.user.delete({ where: { id: userId } });

    console.log("✅ User deleted successfully!");
    res.status(200).json({ message: "User deleted successfully", reason: why });
  } catch (error) {
    console.error("❌ ERROR in /delete-user:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
});
app.get("/get-users", async (req, res) => {
  try {
    console.log("📢 Fetching all users...");

    // Retrieve all users from the database
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
      },
      
    });

    console.log(`✅ Found ${users.length} users.`);
    res.status(200).json({ users });
  } catch (error) {
    console.error("❌ ERROR in /get-users:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
});
app.delete("/delete-user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    console.log("🗑️ Received delete request for user", userId);

    // Validate input
    if (!userId?.trim()) {
      console.warn("❌ Missing userId");
      return res.status(400).json({ error: "User ID is required" });
    }

    // Check if user exists
    console.log("🔍 Checking if user exists...");
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      console.warn("❌ User not found", userId);
      return res.status(404).json({ error: "User not found" });
    }

    // Delete the user
    console.log("🗑️ Deleting user from database...");
    await prisma.user.delete({ where: { id: userId } });

    console.log("✅ User deleted successfully:", userId);
    return res.status(200).json({ message: "User deleted successfully", userId });
  } catch (error) {
    console.error("❌ ERROR in /delete-user:", error);
    return res.status(500).json({ error: "Internal server error", details: error.message });
  }
});
// <--------------Menu---------------->
app.post("/add-menu", async (req, res) => {
  const { menuName, menuDescription, userId } = req.body;

  // Validate that both menuName, menuDescription, and userId are provided
  if (!menuName || !menuDescription || !userId) {
    return res
      .status(400)
      .json({ error: "menuName, menuDescription, and userId are required" });
  }

  try {
    // Create a new menu and associate it with the user
    const newMenu = await prisma.menu.create({
      data: {
        menuName: menuName,
        menuDescription: menuDescription,
        user: {
          connect: { id: userId }, // This associates the menu with the user
        },
      },
    });

    // Respond with the newly created menu
    res.status(201).json({
      message: "Menu added successfully.",
      menu: newMenu,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.delete("/delete-menu/:userId/:menuId", async (req, res) => {
  const { userId, menuId } = req.params;

  // Validate userId and menuId
  if (!userId || !menuId) {
    return res.status(400).json({ error: "userId and menuId are required" });
  }

  try {
    // Check if the user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if the menu exists for this user
    const menuToDelete = await prisma.menu.findFirst({
      where: { id: menuId, userId: userId },
    });

    if (!menuToDelete) {
      return res
        .status(404)
        .json({
          error: "No menu found for this user with the provided menuId",
        });
    }

    // Delete the specific menu
    await prisma.menu.delete({
      where: { id: menuId },
    });

    res.status(200).json({
      message: "Menu deleted successfully.",
    });
  } catch (error) {
    console.error("Error deleting menu:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.put("/update-menu/:userId/:menuId", async (req, res) => {
  const { userId, menuId } = req.params;
  const { menuName, menuDescription } = req.body;

  // Validate input
  if (!menuName && !menuDescription) {
    return res
      .status(400)
      .json({
        error:
          "At least one field (menuName or menuDescription) is required for update.",
      });
  }

  try {
    // Check if the user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if the menu exists for this user
    const existingMenu = await prisma.menu.findFirst({
      where: { id: menuId, userId: userId },
    });

    if (!existingMenu) {
      return res
        .status(404)
        .json({
          error: "No menu found for this user with the provided menuId",
        });
    }

    // Update the menu
    const updatedMenu = await prisma.menu.update({
      where: { id: menuId },
      data: {
        menuName: menuName || existingMenu.menuName,
        menuDescription: menuDescription || existingMenu.menuDescription,
      },
    });

    res.status(200).json({
      message: "Menu updated successfully.",
      menu: updatedMenu,
    });
  } catch (error) {
    console.error("Error updating menu:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/menus", async (req, res) => {
  try {
    const menus = await prisma.menu.findMany({
      include: {
        partitions: {
          select: {
            id: true,
            elements: {
              select: {
                id: true,
              },
            },
          },
        },
        user: {
          // Include user information (userId)
          select: { id: true }, // Only select the user ID
        },
      },
    });

    // Transform the response to include partition and element counts, and userId
    const formattedMenus = menus.map((menu) => ({
      id: menu.id,
      menuName: menu.menuName,
      menuDescription: menu.menuDescription,
      createdAt: menu.createdAt,
      updatedAt: menu.updatedAt,
      numberOfPartitions: menu.partitions.length,
      numberOfElements: menu.partitions.reduce(
        (total, partition) => total + partition.elements.length,
        0
      ),
      userId: menu.user?.id, // Include userId if exists
    }));

    res.status(200).json(formattedMenus);
  } catch (error) {
    console.error("Error fetching menus:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/menu/:userId", async (req, res) => {
  const { userId } = req.params; // Get userId from the URL parameters

  if (!userId) {
    return res.status(400).json({ error: "User ID is required" });
  }

  try {
    // Find menus associated with the userId
    const menus = await prisma.menu.findMany({
      where: {
        userId: userId, // Filter menus by userId
      },
      include: {
        partitions: {
          select: {
            id: true,
            elements: {
              select: {
                id: true,
              },
            },
          },
        },
      },
    });

    // If no menus are found
    if (menus.length === 0) {
      return res.status(404).json({ error: "No menus found for this user" });
    }

    // Format the response with additional information
    const formattedMenus = menus.map((menu) => ({
      id: menu.id,
      menuName: menu.menuName,
      menuDescription: menu.menuDescription,
      createdAt: menu.createdAt,
      updatedAt: menu.updatedAt,
      numberOfPartitions: menu.partitions.length,
      numberOfElements: menu.partitions.reduce(
        (total, partition) => total + partition.elements.length,
        0
      ),
    }));

    // Return the formatted menus
    res.status(200).json(formattedMenus);
  } catch (error) {
    console.error("Error fetching menus:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.delete("/delete-menu/:menuId", async (req, res) => {
  const { menuId } = req.params;  // Extract menuId from the URL parameters

  // Validate menuId
  if (!menuId) {
    return res.status(400).json({ error: "menuId is required" });
  }

  try {
    // Check if the menu exists in the database
    const menuToDelete = await prisma.menu.findUnique({
      where: { id: menuId },
    });

    if (!menuToDelete) {
      return res.status(404).json({ error: "Menu not found" });
    }

    // Delete the specific menu
    await prisma.menu.delete({
      where: { id: menuId },
    });

    res.status(200).json({
      message: "Menu deleted successfully.",
    });
  } catch (error) {
    console.error("Error deleting menu:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// <-----------endMenu-------------->
// <-----------partition----->
app.post("/add-menu-partition", async (req, res) => {
  const { menuId, partitionName, partitionDescription, userId } = req.body; // Include userId in request body

  // Validate the input
  if (!menuId || !partitionName || !partitionDescription || !userId) {
    return res
      .status(400)
      .json({
        error:
          "menuId, partitionName, partitionDescription, and userId are required",
      });
  }

  try {
    // Check if the menu exists
    const existingMenu = await prisma.menu.findUnique({
      where: { id: menuId },
    });

    if (!existingMenu) {
      return res.status(404).json({ error: "Menu not found" });
    }

    // Check if the user exists (optional, but good for validation)
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Create the menu partition and associate it with the user
    const newPartition = await prisma.menuPartition.create({
      data: {
        partitionName,
        partitionDescription,
        menuId, // Linking the partition to a menu
        userId, // Linking the partition to the user
      },
    });

    // Respond with the newly created partition
    res.status(201).json({
      message: "Menu partition added successfully.",
      partition: newPartition,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/partitions/:userId/:menuId", async (req, res) => {
  const { userId, menuId } = req.params; // Get userId and menuId from URL parameters

  try {
    // Fetch partitions associated with both userId and menuId
    const partitions = await prisma.menuPartition.findMany({
      where: {
        userId: userId, // Filter by userId
        menuId: menuId, // Filter by menuId
      },
    });

    // If no partitions found, return a 404 error
    if (!partitions || partitions.length === 0) {
      return res
        .status(404)
        .json({ error: "No partitions found for this user and menu" });
    }

    // Return the partitions
    res.status(200).json(partitions);
  } catch (error) {
    console.error("Error fetching partitions:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.delete("/delete-menu-partition/:userId/:partitionId", async (req, res) => {
  const { userId, partitionId } = req.params;

  if (!userId || !partitionId) {
    return res
      .status(400)
      .json({ error: "userId and partitionId are required" });
  }

  try {
    // Check if the user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if the partition exists for the given user
    const existingPartition = await prisma.menuPartition.findFirst({
      where: {
        id: partitionId,
        userId: userId, // Ensure the partition belongs to this user
      },
    });

    if (!existingPartition) {
      return res
        .status(404)
        .json({ error: "Partition not found for this user" });
    }

    // Delete related elements first
    await prisma.element.deleteMany({
      where: { partitionId: partitionId }, // Delete elements related to this partition
    });

    // Delete the partition
    await prisma.menuPartition.delete({
      where: { id: partitionId },
    });

    res.status(200).json({
      message: "Partition and related elements deleted successfully.",
    });
  } catch (error) {
    console.error("Error deleting menu partition:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.put("/update-menu-partition/:userId", async (req, res) => {
  const { userId } = req.params; // Get the userId from the request parameters
  const { partitionId, partitionName, partitionDescription } = req.body;

  // Validate input
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  if (!partitionId) {
    return res.status(400).json({ error: "partitionId is required" });
  }

  if (!partitionName && !partitionDescription) {
    return res
      .status(400)
      .json({
        error:
          "At least one field (partitionName or partitionDescription) is required for update.",
      });
  }

  try {
    // Check if the user exists
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if the user has the partition
    const existingPartition = await prisma.menuPartition.findFirst({
      where: {
        id: partitionId,
        userId: userId, // Ensure the partition belongs to the user
      },
    });

    if (!existingPartition) {
      return res
        .status(404)
        .json({ error: "Partition not found or does not belong to this user" });
    }

    // Update the partition
    const updatedPartition = await prisma.menuPartition.update({
      where: { id: partitionId },
      data: {
        partitionName: partitionName || existingPartition.partitionName, // Use existing value if not provided
        partitionDescription:
          partitionDescription || existingPartition.partitionDescription, // Use existing value if not provided
      },
    });

    res.status(200).json({
      message: "Menu partition updated successfully.",
      partition: updatedPartition,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
// <------------endPartition-------->
// <------------orders--------->
app.post('/create-order', upload.single('imageUrl'), async (req, res) => {
  const {
    userId,
    partitionId,
    elementName,
    type,
    elementDescription,
    priceSizeOptions,
    quantity,
    additions, // Now should be an array of objects [{ name: "Extra Cheese", price: 2.5 }]
  } = req.body;

  const imageUrl = req.file ? req.file.path : null;

  if (!userId || !partitionId || !elementName || !elementDescription || !priceSizeOptions || !quantity) {
    return res.status(400).json({
      error: "userId, partitionId, elementName, elementDescription, priceSizeOptions, and quantity are required",
    });
  }

  if (!Array.isArray(priceSizeOptions) || priceSizeOptions.length === 0) {
    return res.status(400).json({ error: "priceSizeOptions must be an array with at least one entry" });
  }

  if (!Array.isArray(additions)) {
    return res.status(400).json({ error: "additions must be an array of objects { name, price }" });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const partition = await prisma.menuPartition.findUnique({ where: { id: partitionId } });
    if (!partition) return res.status(404).json({ error: "Partition not found" });

    let element = await prisma.element.findFirst({ where: { partitionId, elementName } });

    if (!element) {
      element = await prisma.element.create({
        data: {
          partitionId,
          elementName,
          type,
          elementDescription,
          priceSizeOptions: JSON.stringify(priceSizeOptions),
          imageUrl: imageUrl || null,
        },
      });
    } else {
      element = await prisma.element.update({
        where: { id: element.id },
        data: {
          priceSizeOptions: JSON.stringify(priceSizeOptions),
          imageUrl: imageUrl || element.imageUrl,
        },
      });
    }

    // Create the order with userId and additions including price
    const newOrder = await prisma.order.create({
      data: {
        userId,
        partitionId,
        elementId: element.id,
        elementName,
        type,
        elementDescription,
        priceSizes: JSON.stringify(priceSizeOptions),
        additions: JSON.stringify(additions), // Store as JSON array of { name, price }
        quantity,
        imageUrl: imageUrl || null,
      },
    });

    res.status(201).json({
      message: "Order created successfully.",
      order: newOrder,
    });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ error: error.message });
  }
});
app.get("/order-summary-status/:userId", async (req, res) => {
  try {
    const { userId } = req.params; // Get user ID from URL parameter

    // Query for orders that belong to the user
    const orders = await prisma.order.findMany({
      where: { userId },
      select: {
        id: true,
        quantity: true,
        priceSizes: true,
        buyerName: true,
        status: true, // Include the status
        user: { select: { id: true, name: true, email: true } }, // Get user details
      },
    });

    // Check if the user has any orders
    if (!orders || orders.length === 0) {
      return res.status(404).json({ error: "No orders found for this user" });
    }

    // Format response for each order
    const formattedOrders = orders.map((order) => {
      // Extract the first 5 letters of the order ID
      const orderIdPrefix = order.id.slice(0, 5);

      // Calculate the total price
      let totalPrice = 0;
      if (order.priceSizes && Array.isArray(order.priceSizes)) {
        totalPrice = order.priceSizes.reduce(
          (sum, priceOption) => sum + priceOption.price,
          0
        );
      } else if (order.priceSizes && typeof order.priceSizes === "object") {
        totalPrice = Object.values(order.priceSizes).reduce(
          (sum, priceOption) => sum + priceOption.price,
          0
        );
      }

      return {
        orderIdPrefix,
        quantity: order.quantity || 0, // Default to 0 if quantity is null or undefined
        totalPrice,
        buyerName: order.buyerName,
        status: order.status, // Include order status
        user: order.user || null, // Include user details
      };
    });

    // Return all orders for the user
    res.status(200).json(formattedOrders);
  } catch (error) {
    console.error("Error fetching order summary and status:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});
app.put("/update-order-status/:orderId", async (req, res) => {
  const { orderId } = req.params; // Get the order ID from the URL parameter
  const { status } = req.body; // Get the new status from the request body

  // Validate the new status
  if (!status || typeof status !== "string") {
    return res
      .status(400)
      .json({
        error: "Invalid status provided. Please provide a valid status.",
      });
  }

  try {
    // Find the order by its ID
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    // Check if the order exists
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Update the order's status
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: { status }, // Set the new status
    });

    // Return the updated order
    res.status(200).json({
      message: "Order status updated successfully",
      order: updatedOrder,
    });
  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});
app.get("/order-details/:userId/:partitionId", async (req, res) => {
  try {
    const { userId, partitionId } = req.params; // Get userId and partitionId from the URL parameters

    // Query for orders by userId and partitionId, including buyerName and createdAt
    const orders = await prisma.order.findMany({
      where: {
        userId: userId,
        partitionId: partitionId, // Add the partitionId filter
      },
      select: {
        id: true,
        buyerName: true,
        createdAt: true,
      },
    });

    // Check if the user has any orders in the given partition
    if (!orders.length) {
      return res
        .status(404)
        .json({
          error: "No orders found for this user in the specified partition",
        });
    }

    // Format the response to include orderIdPrefix (first 5 letters)
    const formattedOrders = orders.map((order) => ({
      orderIdPrefix: order.id.slice(0, 5), // First 5 characters of order ID
      buyerName: order.buyerName || "N/A", // Default to "N/A" if buyerName is null or undefined
      createdAt: order.createdAt, // Date when the order was created
    }));

    // Return the processed data
    res.status(200).json(formattedOrders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ error: "Something went wrong" });
  }
});
app.delete("/delete-order/:userId/:orderId", async (req, res) => {
  const { userId, orderId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  if (!orderId) {
    return res.status(400).json({ error: "orderId is required" });
  }

  try {
    // Check if the order exists for the user with the given orderId
    const existingOrder = await prisma.order.findFirst({
      where: {
        userId: userId,
        id: orderId,
      },
    });

    if (!existingOrder) {
      return res.status(404).json({ error: "Order not found for this user" });
    }

    // Delete the specific order for the user
    await prisma.order.delete({
      where: { id: orderId },
    });

    res.status(200).json({
      message: "Order deleted successfully.",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.delete("/delete-order/:orderId", async (req, res) => {
  const { orderId } = req.params;

  if (!orderId) {
    return res.status(400).json({ error: "orderId is required" });
  }

  try {
    // Check if the order exists
    const existingOrder = await prisma.order.findUnique({
      where: {
        id: orderId,
      },
    });

    if (!existingOrder) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Delete the order
    await prisma.order.delete({
      where: { id: orderId },
    });

    res.status(200).json({
      message: "Order deleted successfully.",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/buy-order", async (req, res) => {
  const { orderId, buyerName, userId } = req.body;

  // Validate inputs
  if (!orderId || !buyerName || !userId) {
    return res
      .status(400)
      .json({ error: "Order ID, buyerName, and userId are required" });
  }

  try {
    // Step 1: Check if the user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Step 2: Check if the order exists
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Step 3: Check if the order is available for purchase
    if (order.status === "completed" || order.status === "canceled") {
      return res
        .status(400)
        .json({ error: "Order has already been completed or canceled" });
    }

    // Step 4: Buy the order (Update status and assign user)
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "completed",
        buyerName: buyerName,
        userId: userId, // Associate order with user
      },
    });

    res.status(200).json({
      message: "Order successfully bought and completed",
      order: updatedOrder,
    });
  } catch (error) {
    console.error("Error buying order:", error);
    res
      .status(500)
      .json({ error: "Something went wrong while processing your order" });
  }
});
app.put("/update-order/:userId/:orderId", async (req, res) => {
  const { userId, orderId } = req.params;
  const {
    elementName,
    elementDescription,
    priceSizeOptions,
    quantity,
    imageUrl,
  } = req.body;

  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  if (!orderId) {
    return res.status(400).json({ error: "orderId is required" });
  }

  if (
    !elementName &&
    !elementDescription &&
    !priceSizeOptions &&
    !quantity &&
    !imageUrl
  ) {
    return res
      .status(400)
      .json({
        error:
          "At least one field (elementName, elementDescription, priceSizeOptions, quantity, or imageUrl) is required for update.",
      });
  }

  try {
    // Find the order with the specific orderId and userId
    const existingOrder = await prisma.order.findFirst({
      where: {
        userId: userId,
        id: orderId,
      },
    });

    if (!existingOrder) {
      return res.status(404).json({ error: "Order not found for this user" });
    }

    // Update the order with the given orderId and userId
    const updatedOrder = await prisma.order.update({
      where: { id: orderId },
      data: {
        elementName: elementName || existingOrder.elementName, // Only update if provided
        elementDescription:
          elementDescription || existingOrder.elementDescription,
        priceSizes: priceSizeOptions || existingOrder.priceSizes,
        quantity: quantity || existingOrder.quantity,
        imageUrl: imageUrl || existingOrder.imageUrl,
      },
    });

    res.status(200).json({
      message: "Order updated successfully.",
      updatedOrder,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/orders", async (req, res) => {
  try {
    const orders = await prisma.order.findMany(); // Fetch all orders
    res.status(200).json(orders);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/orders/:userId/:partitionId", async (req, res) => {
  const { userId, partitionId } = req.params; // Get userId and partitionId from URL parameters

  try {
    // Fetch orders where userId and partitionId match
    const orders = await prisma.order.findMany({
      where: {
        userId: userId,
        partitionId: partitionId,
      },
    });

    // Check if any orders exist
    if (!orders || orders.length === 0) {
      return res
        .status(404)
        .json({ error: "No orders found for this user and partition" });
    }

    res.status(200).json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/your-orders/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Fetch orders for the specified user
    const orders = await prisma.order.findMany({
      where: { userId },
      select: {
        id: true,
        status: true,
        priceSizes: true,
        imageUrl: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "asc", // Sort orders in ascending order by creation date
      },
    });

    if (orders.length === 0) {
      return res.status(404).json({ error: "No orders found for this user." });
    }

    // Fetch car information for the user
    const car = await prisma.car.findFirst({
      where: { ownerId: userId },
      select: { name: true },
    });

    // Fetch feedback for all orders
    const orderIds = orders.map((order) => order.id);
    const feedbacks = await prisma.feedback.findMany({
      where: {
        orderId: { in: orderIds },
      },
      select: {
        orderId: true,
        rating: true,
        comment: true,
      },
    });

    // Transform the response
    const formattedOrders = orders.map((order) => {
      let price = null;
      let size = null;

      // Ensure priceSizes is parsed correctly
      try {
        const parsedPrices = Array.isArray(order.priceSizes)
          ? order.priceSizes
          : JSON.parse(order.priceSizes);

        if (parsedPrices.length > 0) {
          price = parsedPrices[0].price; // Get first price entry
          size = parsedPrices[0].size; // Get first size entry
        }
      } catch (error) {
        console.error("❌ Error parsing priceSizes:", error);
      }

      // Get feedback for the current order
      const feedback = feedbacks.find((f) => f.orderId === order.id);

      return {
        id: order.id,
        status: order.status,
        carName: car?.name || null, // Get car name or return null if not found
        price,
        size,
        date: order.createdAt.toISOString(), // Convert createdAt to a date string
        imageUrl: order.imageUrl,
        rating: feedback?.rating || null, // Include rating if available
        comment: feedback?.comment || null, // Include comment if available
      };
    });

    res.status(200).json({ orders: formattedOrders });
  } catch (error) {
    console.error("❌ ERROR in GET /your-orders:", error);
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});
app.post("/feedback", async (req, res) => {
  try {
    const { userId, orderId, rating, comment } = req.body;

    console.log("✅ Received feedback submission");

    // Validate required fields
    if (!userId || !orderId || rating == null) {
      console.log("❌ Validation failed");
      return res
        .status(400)
        .json({ error: "User ID, order ID, rating, and comment are required" });
    }

    // Ensure rating is a float between 0 and 5
    if (typeof rating !== "number" || rating < 0 || rating > 5) {
      return res
        .status(400)
        .json({ error: "Rating must be a float between 0 and 5" });
    }

    console.log("🔍 Checking if order exists...");
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      console.log("❌ Order not found");
      return res.status(404).json({ error: "Order not found" });
    }

    console.log("📝 Creating feedback...");
    const newFeedback = await prisma.feedback.create({
      data: {
        userId,
        orderId,
        rating,
        comment,
      },
    });

    console.log("✅ Feedback submitted successfully!");
    res.status(201).json({
      message: "Feedback submitted successfully",
      feedback: newFeedback,
    });
  } catch (error) {
    console.error("❌ ERROR in /feedback:", error);
    res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
});
app.post("/commentAndPromocode", async (req, res) => {
  try {
    const { userId, promoCode, comments } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    // تحقق مما إذا كان المستخدم موجودًا
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    let promo = null;
    if (promoCode) {
      promo = await prisma.promoCode.findUnique({
        where: { name: promoCode },
      });

      if (!promo) {
        return res.status(404).json({ error: "Promo code not found" });
      }
    }

    let comment = null;
    if (comments) {
      comment = await prisma.comment.create({
        data: {
          content: comments,
          userId: userId,
          createdAt: new Date(),
        },
      });
    }

    return res.status(200).json({
      message: "Data processed successfully",
      user,
      promoCode: promo,
      comment,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});
app.get("/bestRate", async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      include: {
        feedback: {
          select: { rating: true }, // جلب التقييمات فقط
        },
      },
    });

    // حساب متوسط التقييم لكل طلب
    const ordersWithRatings = orders.map(order => {
      const ratings = order.feedback.map(fb => fb.rating).filter(r => r !== null);
      const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
      return { ...order, avgRating };
    });

    // ترتيب الطلبات تنازليًا حسب التقييم
    ordersWithRatings.sort((a, b) => b.avgRating - a.avgRating);

    res.json(ordersWithRatings);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "حدث خطأ أثناء جلب الطلبات." });
  }
});
app.get("/bestCarsOrder", async (req, res) => {
  try {
    // Step 1: Get all orders and arrange them by the highest rating
    const orders = await prisma.order.findMany({
      include: {
        feedback: {
          select: {
            rating: true,
          },
        },
        user: true,  // Include user details
      },
    });

    // Step 2: Arrange orders by the highest rating
    const bestOrders = orders
      .filter(order => order.feedback.length > 0 && order.user) // Ensure order has feedback and user
      .sort((a, b) => (b.feedback[0]?.rating || 0) - (a.feedback[0]?.rating || 0)); // Sort by rating

    // Step 3: For each best order, fetch the associated user and car
    const results = [];

    for (const bestOrder of bestOrders) {
      const user = bestOrder.user;  // Get the user associated with the order
      if (!user) {
        continue; // Skip if no user is associated with the order
      }

      // Step 4: Fetch the car associated with the user
      const car = await prisma.car.findFirst({
        where: {
          ownerId: user.id,  // Use ownerId instead of userId
        },
        include: {
          orders: {
            where: {
              userId: user.id  // Fetch orders for this specific user
            }
          }
        }
      });

      // Step 5: Push the result in the final array
      results.push({
        order: bestOrder,
        car: car,
        user: user,
      });
    }

    // Step 6: Send the response back with the results
    res.json(results);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/selled/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    // البحث عن المدفوعات بناءً على orderId
    const payments = await prisma.payment.findMany({
      where: { orderId },
    });

    if (payments.length === 0) {
      return res.status(404).json({ error: "لم يتم العثور على أي مدفوعات لهذا الطلب" });
    }

    res.status(200).json(payments);
  } catch (error) {
    console.error("Error fetching payments:", error);
    res.status(500).json({ error: "حدث خطأ أثناء جلب البيانات" });
  }
});
app.post("/client-rate", async (req, res) => {
  try {
    const { userId, paymentId, comment, rating } = req.body;

    // تحقق من أن الحقول الأساسية موجودة
    if (!userId || !paymentId || !comment) {
      return res.status(400).json({ error: "userId, paymentId, and comment are required" });
    }

    // إنشاء التقييم في قاعدة البيانات
    const clientRate = await prisma.clientRate.create({
      data: {
        userId,
        paymentId,
        comment,
        rating: rating || null, // تقييم اختياري
      },
    });

    // إرجاع الاستجابة مع البيانات المخزنة
    res.status(201).json({
      message: "Client rate submitted successfully",
      clientRateId: clientRate.id,
      clientRate,
    });
  } catch (error) {
    console.error("Error submitting client rate:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
});
app.get("/sorder/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // البحث عن الطلبات الخاصة بالمستخدم
    const orders = await prisma.order.findMany({
      where: {
        userId: userId,
      },
    });

    if (!orders.length) {
      return res.status(404).json({ message: "No orders found for this type" });
    }

    res.json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});
app.post('/end', upload.single('image'), async (req, res) => {
  const {
    partitionId,
    elementId,
    elementName,
    elementDescription,
    priceSizes,
    quantity,
    comments,
    buyerName,
    size,
    salad,
    additions,
    userId,
    promoCodeId,
  } = req.body;

  const imageUrl = req.file ? req.file.path : null;

  try {
    const newOrder = await prisma.order.create({
      data: {
        partitionId,
        elementId,
        elementName,
        elementDescription,
        priceSizes,
        quantity,
        imageUrl,
        comments: comments ? { create: comments.map(comment => ({ text: comment })) } : undefined,
        buyerName,
        size,
        salad,
        additions: { set: additions || [] },
        userId,
        promoCodeId,
      }
    });

    res.status(200).json(newOrder);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error creating the order' });
  }
});
app.get("/car-orders", async (req, res) => {
  try {
    // Query to fetch all cars with their owners (optional), their orders (via the owner), and the owner's location
    const cars = await prisma.car.findMany({
      include: {
        owner: {
          include: {
            orders: {
              include: {
                feedback: true,  // Include feedback for each order
              },
            },
            location: true,  // Include the location of the owner (longitude and latitude)
          },
        },
      },
    });

    // Structure the response to return car details, orders (via owner), feedback, and location
    const response = cars.map((car) => ({
      car: {
        id: car.id,
        name: car.name || null,  // If no name, set to null
        address: car.address || null,  // If no name, set to null
        description: car.description || null,  // If no description, set to null
        owner: car.owner,
        token: car.pushToken || null
          ? {
              id: car.owner.id || null,
              name: car.owner.name || null,
              email: car.owner.email || null,
              imagePaths: car.owner.imagePaths || null,
              orders: car.owner.orders.length > 0
                ? car.owner.orders.map((order) => ({
                    id: order.id || null,
                    elementName: order.elementName || null,
                    elementDescription: order.elementDescription || null,
                    status: order.status || null,
                    createdAt: order.createdAt || null,
                    additions:order.additions||null,
                    additionPrice:order.additionPrice||null,
                    userId:order.userId||null,
                    payment:order.payment||null,
                    priceSizes:order.priceSizes||null,
                    quantity:order.quantity||null,
                    imageUrl:order.imageUrl||null,
                    buyerName:order.buyerName||null,
                    feedback: order.feedback.length > 0
                      ? order.feedback.map((fb) => ({
                          id: fb.id || null,
                          rating: fb.rating !== undefined ? fb.rating : null,
                          comment: fb.comment || null,
                          createdAt: fb.createdAt || null,
                        }))
                      : null,  // If no feedback, set to null
                  }))
                : null,  // If no orders, set to null
              location: car.owner.location
                ? {
                    longitude: car.owner.location.longitude || null,
                    latitude: car.owner.location.latitude || null,
                  }
                : null,  // If no location, set to null
          }
          : null,  // If no owner, set to null
      },
    }));

    // Send the response back
    res.json(response);
  } catch (error) {
    console.error("Error fetching cars data:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});
app.get("/car-orders/:carId", async (req, res) => {
  try {
    const { carId } = req.params;

    // Check if the car exists
    const car = await prisma.car.findUnique({
      where: { id: carId },
      include: { owner: { include: { orders: true } } },
    });

    if (!car || !car.owner) {
      return res.status(404).json({ message: "Car or owner not found" });
    }

    return res.status(200).json({
      message: "Car details and orders retrieved successfully",
      car,
      // userOrders: car.owner.orders,
    });
  } catch (error) {
    console.error("Error fetching car orders:", error);
    return res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});
// <---------endorders------>
app.get("/elements/:userId", async (req, res) => {
  const { userId } = req.params; // Get user ID from URL parameter

  try {
    // Fetch elements where userId matches
    const elements = await prisma.element.findMany({
      where: { userId }, // Filter by userId
    });

    // Check if any elements exist
    if (!elements || elements.length === 0) {
      return res.status(404).json({ error: "No elements found for this user" });
    }

    res.status(200).json(elements);
  } catch (error) {
    console.error("Error fetching elements:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/location", async (req, res) => {
  const { longitude, latitude, userId } = req.body;

  // Validate input
  if (longitude === undefined || latitude === undefined) {
    return res
      .status(400)
      .json({ error: "Longitude and latitude are required" });
  }

  try {
    // Create location data
    const locationData = {
      longitude: parseFloat(longitude),
      latitude: parseFloat(latitude),
    };

    // If userId is provided, include it in the location creation
    if (userId) {
      locationData.userId = userId;
    }

    // Store the location in the database
    const location = await prisma.location.create({
      data: locationData,
    });

    // Optionally update user with location if userId is provided
    if (userId) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          locationId: {
            connect: { id: location.id }, // Connect the newly created location to the user
          },
        },
      });
    }

    res.status(201).json({
      message: "Location saved successfully",
      location,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/location/:userId", async (req, res) => {
  const { userId } = req.params; // Get userId from the query parameters

  try {
    if (!userId) {
      return res.status(400).json({ error: "UserId is required" });
    }

    // Fetch locations for the provided userId
    const locations = await prisma.location.findMany({
      where: {
        userId: userId, // Filter by userId
      },
      orderBy: {
        createdAt: "desc", // Sort by newest first
      },
    });

    if (!locations.length) {
      return res
        .status(404)
        .json({ error: "No locations found for this user" });
    }

    res.status(200).json({ locations });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/create-timeline", async (req, res) => {
  const { userId, startDay, endDay, timelineType, schedule } = req.body;

  // Validate input
  if (!userId || !startDay || !endDay || !timelineType || !schedule) {
    return res
      .status(400)
      .json({
        error:
          "userId, startDay, endDay, timelineType, and schedule are required",
      });
  }

  if (timelineType !== "everyday" && timelineType !== "everyweek") {
    return res
      .status(400)
      .json({ error: 'timelineType must be either "everyday" or "everyweek"' });
  }

  if (typeof schedule !== "object" || Object.keys(schedule).length !== 7) {
    return res
      .status(400)
      .json({
        error:
          "schedule must contain exactly 7 days with beginHour and endHour for each",
      });
  }

  try {
    // Check if the user exists
    const userExists = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!userExists) {
      return res.status(404).json({ error: "User not found" });
    }

    // Create the timeline associated with the user
    const newTimeline = await prisma.timeline.create({
      data: {
        userId, // Associate with user
        startDay,
        endDay,
        timelineType,
        schedule, // Store as JSON
      },
    });

    res.status(201).json({
      message: "Timeline created successfully",
      timeline: newTimeline,
    });
  } catch (error) {
    console.error("Error creating timeline:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.put("/update-timeline/:userId", async (req, res) => {
  const { userId } = req.params;
  const { startDay, endDay, timelineType, schedule } = req.body;

  // Validate input
  if (!startDay || !endDay || !timelineType || !schedule) {
    return res
      .status(400)
      .json({
        error: "startDay, endDay, timelineType, and schedule are required",
      });
  }

  if (timelineType !== "everyday" && timelineType !== "everyweek") {
    return res
      .status(400)
      .json({ error: 'timelineType must be either "everyday" or "everyweek"' });
  }

  if (typeof schedule !== "object" || Object.keys(schedule).length !== 7) {
    return res
      .status(400)
      .json({
        error:
          "schedule must contain exactly 7 days with beginHour and endHour for each",
      });
  }

  try {
    // Check if the user exists
    const userExists = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!userExists) {
      return res.status(404).json({ error: "User not found" });
    }

    // Find the existing timeline for this user
    const existingTimeline = await prisma.timeline.findFirst({
      where: { userId },
    });

    if (!existingTimeline) {
      return res
        .status(404)
        .json({ error: "Timeline not found for this user" });
    }

    // Update the timeline
    const updatedTimeline = await prisma.timeline.updateMany({
      where: { userId },
      data: {
        startDay,
        endDay,
        timelineType,
        schedule,
      },
    });

    res.status(200).json({
      message: "Timeline updated successfully",
      timeline: updatedTimeline,
    });
  } catch (error) {
    console.error("Error updating timeline:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/timeline/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    // Check if the user exists
    const userExists = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!userExists) {
      return res.status(404).json({ error: "User not found" });
    }

    // Fetch timelines for the user
    const timelines = await prisma.timeline.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    if (!timelines.length) {
      return res
        .status(404)
        .json({ error: "No timelines found for this user" });
    }

    res.status(200).json({ timelines });
  } catch (error) {
    console.error("Error fetching timelines:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.get("/orders/:type", async (req, res) => {
  const { type } = req.params;

  try {
    const orders = await prisma.order.findMany({
      where: { type },
      include: {
        user: true, // Include user details if needed
        element: true, // Include element details if needed
      },
    });

    if (orders.length === 0) {
      return res.status(404).json({ message: "No orders found for this type" });
    }

    res.status(200).json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ error: error.message });
  }
});
// <---------promoCodes-------->
app.post("/promo-codes", async (req, res) => {
  const { name, percentage, userId } = req.body;

  if (!name || percentage === undefined || !userId) {
    return res
      .status(400)
      .json({ error: "Name, percentage, and userId are required" });
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const promoCode = await prisma.promoCode.create({
      data: {
        name,
        percentage,
        userId,
      },
    });

    res
      .status(201)
      .json({ message: "Promo code created successfully", promoCode });
  } catch (error) {
    console.error("Error creating promo code:", error);
    res.status(500).json({ error: error.message });
  }
});
app.get("/promo-codes/:userId", async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: "User ID is required" });
  }

  try {
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const promoCodes = await prisma.promoCode.findMany({
      where: { userId },
    });

    res.status(200).json(promoCodes);
  } catch (error) {
    console.error("Error fetching promo codes:", error);
    res.status(500).json({ error: error.message });
  }
});
app.get("/promo-codes/:promoCodeId", async (req, res) => {
  const { promoCodeId } = req.params;

  if (!promoCodeId) {
    return res.status(400).json({ error: "Promo Code ID is required" });
  }

  try {
    // Fetch the promo code by promoCodeId
    const promoCode = await prisma.promoCode.findUnique({
      where: { id: promoCodeId },
    });

    if (!promoCode) {
      return res.status(404).json({ error: "Promo code not found" });
    }

    res.status(200).json(promoCode);
  } catch (error) {
    console.error("Error fetching promo code:", error);
    res.status(500).json({ error: error.message });
  }
});
app.put("/promo-codes/:id", async (req, res) => {
  const { id } = req.params;
  const { name, percentage } = req.body;

  try {
    const promoCode = await prisma.promoCode.update({
      where: { id: id }, // Ensure id is treated as a string
      data: { name, percentage },
    });

    res
      .status(200)
      .json({ message: "Promo code updated successfully", promoCode });
  } catch (error) {
    console.error("Error updating promo code:", error);
    res.status(500).json({ error: error.message });
  }
});
app.delete("/promo-codes/:id", async (req, res) => {
  const { id } = req.params; // id is a string from the request

  try {
    await prisma.promoCode.delete({
      where: { id: id }, // Ensure id is treated as a string
    });

    res.status(200).json({ message: "Promo code deleted successfully" });
  } catch (error) {
    console.error("Error deleting promo code:", error);
    res.status(500).json({ error: error.message });
  }
});
// <--------endPromo---------->
// <-------------fav--------->
app.post("/favorites", async (req, res) => {
  const { carId, userId, orderId, carName, carDescription, carImage } = req.body;

  if (!carId || !userId || !carName || !carDescription || !carImage) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const existingFavorite = await prisma.favorite.findFirst({
      where: { userId, carId },
    });

    if (existingFavorite) {
      return res.status(400).json({ message: "Car is already in favorites" });
    }

    const favorite = await prisma.favorite.create({
      data: {
        userId,
        carId,
        orderId: orderId || null, // التأكد من عدم تمرير قيمة `undefined`
        carName: carName || "Unknown Car", // تعيين قيمة افتراضية إذا كانت `null`
        carDescription: carDescription || "No description available",
        carImage: carImage || "https://example.com/default-image.jpg",
      },
    });

    res.status(201).json({ message: "Car added to favorites", favorite });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});
app.get("/favorites/:userId", async (req, res) => {
  const { userId } = req.params;

  // Validate userId
  if (!userId) {
    return res.status(400).json({ message: "Missing userId" });
  }

  try {
    // Fetch the favorites for the given userId
    const favorites = await prisma.favorite.findMany({
      where: { userId },
      include: {
        order: true, 
      },
    });

    if (favorites.length === 0) {
      return res.status(404).json({ message: "No favorites found for this user" });
    }

    res.status(200).json({ favorites });
  } catch (error) {
    console.error("Error fetching favorites:", error);  // Log error for debugging
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});
app.delete("/favorites", async (req, res) => {
  const { carId, userId } = req.body;

  if (!carId || !userId) {
    return res.status(400).json({ message: "Missing carId or userId" });
  }

  try {
    await prisma.favorite.deleteMany({
      where: { userId, carId },
    });

    res.status(200).json({ message: "Order removed from favorites" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Internal Server Error", error: error.message });
  }
});
// <-------------endFav--------->
// <--------additions-------->

// <-----------end additions----------->
app.post("/notifications", async (req, res) => {
  const { message, type, userId, expireAt } = req.body;

  if (!message || !type || !userId) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const notification = await prisma.notification.create({
      data: { 
        message, 
        type, 
        userId, 
        expireAt: expireAt ? new Date(expireAt) : null 
      },
    });

    res.status(201).json({
      id: notification.id.toString(),
      message: notification.message,
      type: notification.type,
      isRead: notification.isRead,
      createdAt: notification.createdAt.toISOString(),
      updatedAt: notification.updatedAt.toISOString(),
      expireAt: notification.expireAt ? notification.expireAt.toISOString() : null,
      userId: notification.userId.toString(),
    });
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }});
app.get("/notifications", async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      orderBy: { createdAt: "desc" },
    });

    const formattedNotifications = notifications.map((notif) => ({
      id: notif.id,
      message: notif.message,
      type: notif.type,
      isRead: notif.isRead,
      createdAt: notif.createdAt,
      updatedAt: notif.updatedAt,
      expireAt: notif.expireAt,
      userId: notif.userId,
    }));

    res.status(200).json(formattedNotifications);
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }});
app.get("/notifications/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    const formattedNotifications = notifications.map((notif) => ({
      id: notif.id,
      message: notif.message,
      type: notif.type,
      isRead: notif.isRead,
      createdAt: notif.createdAt,
      updatedAt: notif.updatedAt,
      expireAt: notif.expireAt,
      userId: notif.userId,
    }));

    res.status(200).json(formattedNotifications);
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});
app.put("/notifications/:id/read", async (req, res) => {
  const { id } = req.params;

  try {
    const notification = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    res.status(200).json({
      id: notification.id,
      message: notification.message,
      type: notification.type,
      isRead: notification.isRead,
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
      expireAt: notification.expireAt,
      userId: notification.userId,
    });
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});
app.delete("/notifications/expired", async (req, res) => {
  try {
    const now = new Date();
    const deleted = await prisma.notification.deleteMany({
      where: { expireAt: { lt: now } },
    });

    res.status(200).json({ message: "Expired notifications deleted", deletedCount: deleted.count });
  } catch (error) {
    res.status(500).json({ message: "Internal Server Error", error: error.message });
  }
});
// <---------endNotfication------->

app.post('/customers', async (req, res) => {
  try {
      const { name, phone, address, carId, orders = [] } = req.body;

      const customer = await prisma.customer.create({
          data: {
              name: name || null,
              phone: phone || null,
              address: address || null,
              car: carId ? { connect: { id: carId } } : undefined,
              orders: {
                  create: orders.map(order => {
                      const orderEntry = {
                          partitionId: order.partitionId || null,
                          size: order.size || null,
                          quantity: order.quantity || 1,
                          additions: order.additions || [],
                          car: carId ? { connect: { id: carId } } : undefined
                      };

                      if (order.elementId) {
                          orderEntry.elementId = String(order.elementId);
                      }

                      return orderEntry;
                  })
              }
          },
          include: { orders: true }
      });

      res.status(201).json({ success: true, customer });
  } catch (error) {
      console.error(error);
      res.status(500).json({ success: false, error: error.message });
  }
});
app.get("/customers/:carId", async (req, res) => {
  try {
      const { carId } = req.params;

      const customers = await prisma.customer.findMany({ // ✅ دعم أكثر من عميل بنفس carId
          where: { carId },
          include: { orders: true }
      });

      if (!customers || customers.length === 0) {
          return res.status(404).json({ message: "No customers found for this carId" });
      }

      res.json(customers);
  } catch (error) {
      console.error(error);
      res.status(500).json({ error: error.message });
  }
});


app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});


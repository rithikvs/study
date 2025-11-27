# StudyHub - Collaborative Study Platform

A real-time collaborative study room application built with the MERN stack (MongoDB Atlas, Express, React, Node.js) featuring authentication, group management, and real-time note editing.

## 🌐 Live Deployment

- **Frontend (Vercel)**: https://study-fwpj.vercel.app
- **Backend (Render)**: https://study-2-5wjr.onrender.com

## 🚀 Features

- ✅ **User Authentication** - Register/Login with MongoDB Atlas
- ✅ **Persistent Sessions** - Stay logged in across browser sessions
- ✅ **Create Study Rooms** - Generate unique 6-character room codes
- ✅ **Join Rooms** - Multiple users can join the same room with room code
- ✅ **Real-time Collaboration** - Live note editing with Socket.IO
- ✅ **Multi-device Support** - Access from any device (desktop, tablet, mobile)
- ✅ **User Management** - See all members in a room
- ✅ **Cloud Database** - All data stored in MongoDB Atlas

## 📱 Access from Any Device

### On Your Computer:
Visit: https://study-fwpj.vercel.app

### On Mobile/Tablet:
1. Open your mobile browser (Chrome, Safari, etc.)
2. Navigate to: https://study-fwpj.vercel.app
3. Login with your account or register a new one
4. All your data syncs automatically from MongoDB Atlas!

### Share Room with Others:
1. Create a room and get the 6-character code (e.g., "ABC123")
2. Share the code with friends
3. They can join from any device using the same code
4. All members see real-time updates

## 🛠️ Technology Stack

### Frontend:
- React 18.3.1
- Vite 5.4.0
- Tailwind CSS
- Socket.IO Client
- Axios
- React Router DOM

### Backend:
- Node.js & Express
- MongoDB Atlas (Cloud Database)
- Socket.IO (Real-time communication)
- JWT Authentication
- bcryptjs (Password hashing)

## 📦 Local Development Setup

### Prerequisites:
- Node.js (v18 or higher)
- MongoDB Atlas account
- Git

### Installation:

1. **Clone the repository**
```bash
git clone https://github.com/rithikvs/study.git
cd study
```

2. **Setup Backend**
```bash
cd server
npm install
```

Create `.env` file in `server` directory:
```env
MONGO_URI=your_mongodb_atlas_connection_string
JWT_SECRET=your_jwt_secret_key
PORT=4000
```

Start backend:
```bash
npm start
```

3. **Setup Frontend**
```bash
cd ../client
npm install
npm run dev
```

Frontend runs on: http://localhost:5173
Backend runs on: http://localhost:4000

## 🌍 Deployment

### Backend (Render):
1. Connected to GitHub repository
2. Auto-deploys on push to main branch
3. Environment variables configured in Render dashboard

### Frontend (Vercel):
1. Connected to GitHub repository
2. Auto-deploys on push to main branch
3. Production API URL configured in `.env.production`

## 🔐 Authentication Flow

1. **Registration**: User creates account → Stored in MongoDB Atlas → JWT token generated
2. **Login**: Credentials verified against MongoDB → Token stored in localStorage
3. **Persistent Auth**: Token automatically sent with every API request via Authorization header
4. **Cross-device**: Login on any device with same credentials, data syncs from Atlas

## 📝 Usage

### Create a Study Room:
1. Login/Register
2. Go to Home page
3. Click "Create Group"
4. Enter group name
5. Get your unique room code

### Join a Room:
1. Login/Register
2. Enter room code in "Join by Code"
3. Click Join
4. Access shared notes in the room

### Collaborate in Real-time:
1. Create notes in the room
2. Edit notes - all members see updates instantly
3. View all room members at the top

## 🔄 Data Synchronization

All data is stored in **MongoDB Atlas** cloud database:
- User accounts and passwords (hashed)
- Study groups and room codes
- Notes and their content
- Group memberships

Access your data from anywhere - just login with your credentials!

## 🤝 Contributing

This is a study project. Feel free to fork and experiment!

## 📄 License

ISC

## 👨‍💻 Author

rithikvs

---

**Note**: The Render free tier may spin down after inactivity. First request might take 30-60 seconds to wake up the server.

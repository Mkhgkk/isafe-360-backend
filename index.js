const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const exifParser = require("exif-parser");
const { spawn } = require("child_process");
const { credential } = require("firebase-admin");

const app = express();
const port = 3000;

// Enable CORS
app.use(cors());

// Serve static files from the uploads directory
app.use("/detected", express.static(path.join(__dirname, "detected")));

// Set up Multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

// Create directories if they do not exist
const directories = ["./uploads", "./detected"];
directories.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
});

// Function to extract metadata from an image file
const extractMetadata = (filePath) => {
  const buffer = fs.readFileSync(filePath);
  const parser = exifParser.create(buffer);
  const result = parser.parse();
  return result.tags;
};

// Function to execute detection
const performDetectionAsync = (filename, socketId) =>
  new Promise((resolve, reject) => {
    const command = "python";
    const scriptPath = path.join(
      "C:",
      "Users",
      "contil",
      "Downloads",
      "360detect",
      "main.py"
    );
    const args = [
      scriptPath,
      path.join(
        "C:",
        "Users",
        "contil",
        "Projects",
        "isafe-360-backend",
        "uploads",
        filename
      ),
      path.join(
        "C:",
        "Users",
        "contil",
        "Projects",
        "isafe-360-backend",
        "detected",
        filename
      ),
    ];

    const child = spawn(command, args);

    // Listen for standard output
    child.stdout.on("data", (data) => {
      io.to(socketId).emit("detection-data", data);
      console.log(`Standard Output:\n${data}`);
    });

    // Listen for standard error
    child.stderr.on("data", (data) => {
      console.error(`Standard Error:\n${data}`);
    });

    // Listen for the close event
    child.on("close", (code) => {
      if (code !== 0) {
        console.error(`Child process exited with code ${code}`);
        reject();
      } else {
        console.log(`Child process exited successfully with code ${code}`);
        resolve();
      }
    });

    // Handle errors during spawn
    child.on("error", (error) => {
      console.error(`Failed to start subprocess: ${error}`);
      reject();
    });
  });

// File upload route
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file uploaded.");
  }

  // Extract metadata from the uploaded file
  let metadata;
  try {
    metadata = extractMetadata(req.file.path);
  } catch (error) {
    return res.status(500).send("Error extracting metadata.");
  }

  // Perform detection
  await performDetectionAsync(req.file.filename, req.body.socketId);

  res.send({
    filename: req.file.filename,
    path: req.file.path,
    url: `${req.protocol}://${req.get("host")}/detected/${req.file.filename}`,
    metadata: metadata,
  });
});

// Start the server
const server = app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

const io = require("socket.io")(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

io.on("connection", (socket) => {
  console.log(`Client with ID ${socket.id} has been connected..`);

  socket.on("disconnect", () => console.log("Socket disconnected.."));
});

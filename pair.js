const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const FormData = require("form-data");
const os = require('os'); 
const mongoose = require('mongoose');
const { sms, downloadMediaMessage } = require("./msg");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    S_WHATSAPP_NET
} = require('@whiskeysockets/baileys');

const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['💋', '😶', '✨️', '💗', '🎈', '🎉', '🥳', '❤️', '🧫', '🐢'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    IMAGE_PATH: 'https://files.catbox.moe/jwmx1j.jpg',
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/IdGNaKt80DEBqirc2ek4ks',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: 'https://files.catbox.moe/jwmx1j.jpg',
    NEWSLETTER_JID: '120363421404091643@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    version: '1.0.0',
    OWNER_NUMBER: '255612491554',
    BOT_FOOTER: '>  © 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🐢𝚂𝙸𝙻𝙰-𝙼𝙳',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbBmFT430LKO7Ch9C80X'
};

// MongoDB Configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://kaviduinduwara:kavidu2008@cluster0.bqmspdf.mongodb.net/soloBot?retryWrites=true&w=majority&appName=Cluster0';

// Connect to MongoDB
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
}).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

// MongoDB Schemas
const sessionSchema = new mongoose.Schema({
  number: { type: String, required: true, unique: true },
  sessionId: { type: String },
  settings: { type: Object, default: {} },
  creds: { type: Object },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const settingsSchema = new mongoose.Schema({
  number: { type: String, required: true, unique: true },
  settings: { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// MongoDB Models
const Session = mongoose.model('Session', sessionSchema);
const Settings = mongoose.model('Settings', settingsSchema);

console.log('✅ Using MongoDB database system');

// Custom findOneAndUpdate for Session
Session.findOneAndUpdate = async function(query, update, options = {}) {
  try {
    const session = await this.findOne(query);
    
    if (session) {
      // Handle $set operator
      if (update.$set) {
        Object.assign(session, update.$set);
      } else {
        Object.assign(session, update);
      }
      session.updatedAt = new Date();
      await session.save();
      return session;
    } else if (options.upsert) {
      const newSession = new this({
        ...query,
        ...update.$set,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await newSession.save();
      return newSession;
    }
    return null;
  } catch (error) {
    console.error('Error in findOneAndUpdate:', error);
    return null;
  }
};

// Custom findOneAndUpdate for Settings
Settings.findOneAndUpdate = async function(query, update, options = {}) {
  try {
    const settings = await this.findOne(query);
    
    if (settings) {
      // Handle $set operator
      if (update.$set) {
        Object.assign(settings.settings, update.$set);
      } else {
        Object.assign(settings.settings, update);
      }
      settings.updatedAt = new Date();
      await settings.save();
      return settings;
    } else if (options.upsert) {
      const newSettings = new this({
        ...query,
        settings: update.$set || update,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await newSettings.save();
      return newSettings;
    }
    return null;
  } catch (error) {
    console.error('Error in Settings findOneAndUpdate:', error);
    return null;
  }
};

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();

// Auto-reply messages with bold font
const autoReplies = {
    'hi': '*𝙷𝚎𝚕𝚕𝚘! 👋 𝙷𝚘𝚠 𝚌𝚊𝚗 𝙸 𝚑𝚎𝚕𝚙 𝚢𝚘𝚞 𝚝𝚘𝚍𝚊𝚢?*',
    'mambo': '*𝙿𝚘𝚊 𝚜𝚊𝚗𝚊! 👋 𝙽𝚒𝚔𝚞𝚜𝚊𝚒𝚍𝚒𝚎 𝙺𝚞𝚑𝚞𝚜𝚞?*',
    'hey': '*𝙷𝚎𝚢 𝚝𝚑𝚎𝚛𝚎! 😊 𝚄𝚜𝚎 .𝚖𝚎𝚗𝚞 𝚝𝚘 𝚜𝚎𝚎 𝚊𝚕𝚕 𝚊𝚟𝚊𝚒𝚕𝚊𝚋𝚕𝚎 𝚌𝚘𝚖𝚖𝚊𝚗𝚍𝚜.*',
    'vip': '*𝙷𝚎𝚕𝚕𝚘 𝚅𝙸𝙿! 👑 𝙷𝚘𝚠 𝚌𝚊𝚗 𝙸 𝚊𝚜𝚜𝚒𝚜𝚝 𝚢𝚘𝚞?*',
    'mkuu': '*𝙷𝚎𝚢 𝚖𝚔𝚞𝚞! 👋 𝙽𝚒𝚔𝚞𝚜𝚊𝚒𝚍𝚒𝚎 𝙺𝚞𝚑𝚞𝚜𝚞?*',
    'boss': '*𝚈𝚎𝚜 𝚋𝚘𝚜𝚜! 👑 𝙷𝚘𝚠 𝚌𝚊𝚗 𝙸 𝚑𝚎𝚕𝚙 𝚢𝚘𝚞?*',
    'habari': '*𝙽𝚣𝚞𝚛𝚒 𝚜𝚊𝚗𝚊! 👋 𝙷𝚊𝚋𝚊𝚛𝚒 𝚢𝚊𝚔𝚘?*',
    'hello': '*𝙷𝚒 𝚝𝚑𝚎𝚛𝚎! 😊 𝚄𝚜𝚎 .𝚖𝚎𝚗𝚞 𝚝𝚘 𝚜𝚎𝚎 𝚊𝚕𝚕 𝚊𝚟𝚊𝚒𝚕𝚊𝚋𝚕𝚎 𝚌𝚘𝚖𝚖𝚊𝚗𝚍𝚜.*',
    'bot': '*𝚈𝚎𝚜, 𝙸 𝚊𝚖 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸 𝚜𝟷! 🤖 𝙷𝚘𝚠 𝚌𝚊𝚗 𝙸 𝚊𝚜𝚜𝚒𝚜𝚝 𝚢𝚘𝚞?*',
    'menu': '*𝚃𝚢𝚙𝚎 .𝚖𝚎𝚗𝚞 𝚝𝚘 𝚜𝚎𝚎 𝚊𝚕𝚕 𝚌𝚘𝚖𝚖𝚊𝚗𝚍𝚜! 📜*',
    'owner': '*𝙲𝚘𝚗𝚝𝚊𝚌𝚝 𝚘𝚠𝚗𝚎𝚛 𝚞𝚜𝚒𝚗𝚐 .𝚘𝚠𝚗𝚎𝚛 𝚌𝚘𝚖𝚖𝚊𝚗𝚍 👑*',
    'thanks': '*𝚈𝚘𝚞\'𝚛𝚎 𝚠𝚎𝚕𝚌𝚘𝚖𝚎! 😊*',
    'thank you': '*𝙰𝚗𝚢𝚝𝚒𝚖𝚎! 𝙻𝚎𝚝 𝚖𝚎 𝚔𝚗𝚘𝚠 𝚒𝚏 𝚢𝚘𝚞 𝚗𝚎𝚎𝚍 𝚑𝚎𝚕𝚙 🤖*'
};

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Africa/Nairobi').format('YYYY-MM-DD HH:mm:ss');
}

async function cleanDuplicateFiles(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        
        // Use MongoDB instead of GitHub
        const sessions = await Session.find({ number: sanitizedNumber })
            .sort({ updatedAt: -1 }); // Latest first
        
        if (sessions.length > 1) {
            // Keep only the latest session
            const latestSession = sessions[0];
            const idsToDelete = sessions.slice(1).map(s => s._id);
            
            await Session.deleteMany({ 
                _id: { $in: idsToDelete } 
            });
            console.log(`Deleted ${idsToDelete.length} duplicate sessions for ${sanitizedNumber}`);
        }
        
        // Check if config exists
        const existingConfig = await Settings.findOne({ number: sanitizedNumber });
        if (existingConfig) {
            console.log(`Config for ${sanitizedNumber} already exists`);
        }
    } catch (error) {
        console.error(`Failed to clean duplicate files for ${number}:`, error);
    }
}

let totalcmds = async () => {
  try {
    const filePath = "./pair.js";
    const mytext = await fs.readFile(filePath, "utf-8");
    const caseRegex = /(^|\n)\s*case\s*['"][^'"]+['"]\s*:/g;
    const lines = mytext.split("\n");
    let count = 0;

    for (const line of lines) {
      if (line.trim().startsWith("//") || line.trim().startsWith("/*")) continue;
      if (line.match(/^\s*case\s*['"][^'"]+['"]\s*:/)) {
        count++;
      }
    }
    return count;
  } catch (error) {
    console.error("Error reading pair.js:", error.message);
    return 0;
  }
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES || 3;
    let inviteCode = 'JlI0FDZ5RpAEbeKvzAPpFt';
    if (config.GROUP_INVITE_LINK) {
        const cleanInviteLink = config.GROUP_INVITE_LINK.split('?')[0];
        const inviteCodeMatch = cleanInviteLink.match(/chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]+)/);
        if (!inviteCodeMatch) {
            console.error('Invalid group invite link format:', config.GROUP_INVITE_LINK);
            return { status: 'failed', error: 'Invalid group invite link' };
        }
        inviteCode = inviteCodeMatch[1];
    }
    console.log(`Attempting to join group with invite code: ${inviteCode}`);

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            console.log('Group join response:', JSON.stringify(response, null, 2));
            if (response?.gid) {
                console.log(`[ ✅ ] Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message.includes('gone') || error.message.includes('not-found')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group: ${errorMessage} (Retries left: ${retries})`);
            if (retries === 0) {
                console.error('[ ❌ ] Failed to join group', { error: errorMessage });
                try {
                    const ownerNumber = config.OWNER_NUMBER;
                    await socket.sendMessage(`${ownerNumber}@s.whatsapp.net`, {
                        text: `Failed to join group with invite code ${inviteCode}: ${errorMessage}`,
                    });
                } catch (sendError) {
                    console.error(`Failed to send failure message to owner: ${sendError.message}`);
                }
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries + 1));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔐 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        ' © 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🐢𝚂𝙸𝙻𝙰-𝙼𝙳'
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}

function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;

        const allNewsletterJIDs = await loadNewsletterJIDsFromRaw();
        const jid = message.key.remoteJid;

        if (!allNewsletterJIDs.includes(jid)) return;

        try {
            const emojis = ['🩵', '🫶', '😀', '👍', '😶'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;

            if (!messageId) {
                console.warn('No newsletterServerId found in message:', message);
                return;
            }

            let retries = 3;
            while (retries-- > 0) {
                try {
                    await socket.newsletterReactMessage(jid, messageId.toString(), randomEmoji);
                    console.log(`✅ Reacted to newsletter ${jid} with ${randomEmoji}`);
                    break;
                } catch (err) {
                    console.warn(`❌ Reaction attempt failed (${3 - retries}/3):`, err.message);
                    await delay(1500);
                }
            }
        } catch (error) {
            console.error('⚠️ Newsletter reaction handler failed:', error.message);
        }
    });
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;

        try {
            if (config.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }

            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;

        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        
        const message = formatMessage(
            '🗑️ MESSAGE DELETED',
            `A message was deleted from your chat.\n📋 From: ${messageKey.remoteJid}\n🐢 Deletion Time: ${deletionTime}`,
            '> © 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🐢𝚂𝙸𝙻𝙰-𝙼𝙳'
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: message
            });
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

async function oneViewmeg(socket, isOwner, msg, sender) {
    if (!isOwner) {
        await socket.sendMessage(sender, {
            text: '*❌ 𝚘𝚗𝚕𝚢 𝚋𝚘𝚝 𝚘𝚠𝚗𝚎𝚛 𝚌𝚊𝚗 𝚟𝚒𝚎𝚠 𝚘𝚗𝚌𝚎 𝚖𝚎𝚜𝚜𝚊𝚐𝚎𝚜!*'
        });
        return;
    }
    try {
        const quoted = msg;
        let cap, anu;
        if (quoted.imageMessage?.viewOnce) {
            cap = quoted.imageMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.imageMessage);
            await socket.sendMessage(sender, { image: { url: anu }, caption: cap });
        } else if (quoted.videoMessage?.viewOnce) {
            cap = quoted.videoMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.videoMessage);
            await socket.sendMessage(sender, { video: { url: anu }, caption: cap });
        } else if (quoted.audioMessage?.viewOnce) {
            cap = quoted.audioMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.audioMessage);
            await socket.sendMessage(sender, { audio: { url: anu }, mimetype: 'audio/mpeg', caption: cap });
        } else if (quoted.viewOnceMessageV2?.message?.imageMessage) {
            cap = quoted.viewOnceMessageV2.message.imageMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2.message.imageMessage);
            await socket.sendMessage(sender, { image: { url: anu }, caption: cap });
        } else if (quoted.viewOnceMessageV2?.message?.videoMessage) {
            cap = quoted.viewOnceMessageV2.message.videoMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2.message.videoMessage);
            await socket.sendMessage(sender, { video: { url: anu }, caption: cap });
        } else if (quoted.viewOnceMessageV2Extension?.message?.audioMessage) {
            cap = quoted.viewOnceMessageV2Extension.message.audioMessage.caption || "";
            anu = await socket.downloadAndSaveMediaMessage(quoted.viewOnceMessageV2Extension.message.audioMessage);
            await socket.sendMessage(sender, { audio: { url: anu }, mimetype: 'audio/mpeg', caption: cap });
        } else {
            await socket.sendMessage(sender, {
                text: '*❌ 𝙽𝚘𝚝 𝚊 𝚟𝚊𝚕𝚒𝚍 𝚟𝚒𝚎𝚠-𝚘𝚗𝚌𝚎 𝚖𝚎𝚜𝚜𝚊𝚐𝚎, 𝚕𝚘𝚟𝚎!* 😢'
            });
        }
        if (anu && fs.existsSync(anu)) fs.unlinkSync(anu);
    } catch (error) {
        console.error('oneViewmeg error:', error);
        await socket.sendMessage(sender, {
            text: `*❌ 𝙵𝚊𝚒𝚕𝚎𝚍 𝚝𝚘 𝚙𝚛𝚘𝚌𝚎𝚜𝚜 𝚟𝚒𝚎𝚠-𝚘𝚗𝚌𝚎 𝚖𝚎𝚜𝚜𝚊𝚐𝚎, 𝚋𝚊𝚋𝚎!* 😢\nError: ${error.message || 'Unknown error'}`
        });
    }
}

// Setup Auto Bio
async function setupAutoBio(socket) {
    try {
        const bios = [
            "🌟 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸 - 𝚈𝚘𝚞𝚛 𝚞𝚕𝚝𝚒𝚖𝚊𝚝𝚎 𝚆𝚑𝚊𝚝𝚜𝙰𝚙𝚙 𝚋𝚘𝚝",
            "🚀 𝙿𝚘𝚠𝚎𝚛𝚎𝚍 𝚋𝚢 𝚂𝙸𝙻𝙰 𝚃𝚎𝚌𝚑𝚗𝚘𝚕𝚘𝚐𝚒𝚎𝚜",
            "💫 𝙰𝚕𝚠𝚊𝚢𝚜 𝚊𝚝 𝚢𝚘𝚞𝚛 𝚜𝚎𝚛𝚟𝚒𝚌𝚎!",
            "🎯 𝙵𝚊𝚜𝚝, 𝚂𝚎𝚌𝚞𝚛𝚎 & 𝚁𝚎𝚕𝚒𝚊𝚋𝚕𝚎",
            "🤖 𝚂𝙸𝙻𝙰 𝙼𝙳 - 𝚈𝚘𝚞𝚛 𝚍𝚒𝚐𝚒𝚝𝚊𝚕 𝚊𝚜𝚜𝚒𝚜𝚝𝚊𝚗𝚝"
        ];
        
        const randomBio = bios[Math.floor(Math.random() * bios.length)];
        await socket.updateProfileStatus(randomBio);
        console.log('✅ Auto bio updated:', randomBio);
    } catch (error) {
        console.error('❌ Failed to update auto bio:', error);
    }
}

async function deleteSessionFromGitHub(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        
        // Delete session from MongoDB
        await Session.deleteMany({ number: sanitizedNumber });
        
        // Delete settings from MongoDB
        await Settings.deleteOne({ number: sanitizedNumber });
        
        console.log(`Deleted session for ${sanitizedNumber} from MongoDB`);
    } catch (error) {
        console.error('Failed to delete session:', error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        
        // Get session from MongoDB
        const session = await Session.findOne({ number: sanitizedNumber })
            .sort({ updatedAt: -1 });
        
        if (!session) {
            console.log(`No session found in MongoDB for ${sanitizedNumber}`);
            return null;
        }
        
        return session.creds;
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        
        // Get config from MongoDB
        const configDoc = await Settings.findOne({ number: sanitizedNumber });
        
        if (!configDoc) {
            console.warn(`No configuration found for ${number}, using default config`);
            return { ...config };
        }
        
        return { ...config, ...configDoc.settings };
    } catch (error) {
        console.error('Failed to load config:', error);
        return { ...config };
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        
        // Update or create config in MongoDB
        await Settings.findOneAndUpdate(
            { number: sanitizedNumber },
            { $set: newConfig },
            { upsert: true, new: true }
        );
        
        console.log(`Updated config for ${sanitizedNumber} in MongoDB`);
    } catch (error) {
        console.error('Failed to update config:', error);
        throw error;
    }
}

async function sendAdminConnectMessage(socket, number, groupResult) {
    try {
        const ownerJid = `${config.OWNER_NUMBER}@s.whatsapp.net`;
        const timestamp = getSriLankaTimestamp();
        const groupStatus = groupResult.status === 'success'
            ? `✅ 𝙟𝙤𝙞𝙣𝙚𝙙 𝙜𝙧𝙤𝙪𝙥: ${groupResult.gid}`
            : `❌ 𝙛𝙖𝙞𝙡𝙚𝙙 𝙩𝙤 𝙟𝙤𝙞𝙣 𝙜𝙧𝙤𝙪𝙙: ${groupResult.error}`;

        const adminMessage = formatMessage(
            '🔔 𝙽𝙴𝚆 𝙲𝙾𝙽𝙽𝙴𝙲𝚃𝙸𝙾𝙽',
            `*𝙽𝚞𝚖𝚋𝚎𝚛:* ${number}\n*𝚃𝚒𝚖𝚎:* ${timestamp}\n*𝚂𝚝𝚊𝚝𝚞𝚜:* ✅ 𝙲𝚘𝚗𝚗𝚎𝚌𝚝𝚎𝚍\n${groupStatus}`,
            '>  *© 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🐢𝚂𝙸𝙻𝙰-𝙼𝙳*'
        );

        await socket.sendMessage(ownerJid, {
            image: { url: 'https://files.catbox.moe/jwmx1j.jpg' },
            caption: adminMessage
        });
    } catch (error) {
        console.error('Failed to send admin message:', error);
    }
}

async function updateNumberListOnGitHub(newNumber) {
    try {
        const sanitizedNumber = newNumber.replace(/[^0-9]/g, '');
        
        // Get current numbers from file
        let numbers = [];
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            const fileContent = fs.readFileSync(NUMBER_LIST_PATH, 'utf8');
            numbers = JSON.parse(fileContent) || [];
        }
        
        // Add number if not already in list
        if (!numbers.includes(sanitizedNumber)) {
            numbers.push(sanitizedNumber);
            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
            console.log(`Added ${sanitizedNumber} to local numbers.json`);
        }
    } catch (error) {
        console.error('Failed to update numbers list:', error);
    }
}

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        const type = getContentType(msg.message);
        if (!msg.message) return;
        msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const m = sms(socket, msg);
        const quoted =
            type == "extendedTextMessage" &&
            msg.message.extendedTextMessage.contextInfo != null
              ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
              : [];
        const body = (type === 'conversation') ? msg.message.conversation 
            : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') 
                ? msg.message.extendedTextMessage.text 
            : (type == 'interactiveResponseMessage') 
                ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage 
                    && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id 
            : (type == 'templateButtonReplyMessage') 
                ? msg.message.templateButtonReplyMessage?.selectedId 
            : (type === 'extendedTextMessage') 
                ? msg.message.extendedTextMessage.text 
            : (type == 'imageMessage') && msg.message.imageMessage.caption 
                ? msg.message.imageMessage.caption 
            : (type == 'videoMessage') && msg.message.videoMessage.caption 
                ? msg.message.videoMessage.caption 
            : (type == 'buttonsResponseMessage') 
                ? msg.message.buttonsResponseMessage?.selectedButtonId 
            : (type == 'listResponseMessage') 
                ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
            : (type == 'messageContextInfo') 
                ? (msg.message.buttonsResponseMessage?.selectedButtonId 
                    || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
                    || msg.text) 
            : (type === 'viewOnceMessage') 
                ? msg.message[type]?.message[getContentType(msg.message[type].message)] 
            : (type === "viewOnceMessageV2") 
                ? (msg.message[type]?.message?.imageMessage?.caption || msg.message[type]?.message?.videoMessage?.caption || "") 
            : '';
        let sender = msg.key.remoteJid;
        const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid);
        const senderNumber = nowsender.split('@')[0];
        const developers = `${config.OWNER_NUMBER}`;
        const botNumber = socket.user.id.split(':')[0];
        const isbot = botNumber.includes(senderNumber);
        const isOwner = isbot ? isbot : developers.includes(senderNumber);
        var prefix = config.PREFIX;
        var isCmd = body.startsWith(prefix);
        const from = msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '.';
        var args = body.trim().split(/ +/).slice(1);

        // Auto-reply handler
        const lowerBody = body.toLowerCase().trim();
        if (autoReplies[lowerBody] && !isCmd) {
            await socket.sendMessage(sender, { 
                text: autoReplies[lowerBody] 
            }, { quoted: msg });
            return;
        }

        async function isGroupAdmin(jid, user) {
            try {
                const groupMetadata = await socket.groupMetadata(jid);
                const participant = groupMetadata.participants.find(p => p.id === user);
                return participant?.admin === 'admin' || participant?.admin === 'superadmin' || false;
            } catch (error) {
                console.error('Error checking group admin status:', error);
                return false;
            }
        }

        const isSenderGroupAdmin = isGroup ? await isGroupAdmin(from, nowsender) : false;

        socket.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
            let quoted = message.msg ? message.msg : message;
            let mime = (message.msg || message).mimetype || '';
            let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
            const stream = await downloadContentFromMessage(quoted, messageType);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            let type = await FileType.fromBuffer(buffer);
            trueFileName = attachExtension ? (filename + '.' + type.ext) : filename;
            await fs.writeFileSync(trueFileName, buffer);
            return trueFileName;
        };

        if (!command) return;
        const count = await totalcmds();

        const fakevCard = {
            key: {
                fromMe: false,
                participant: "0@s.whatsapp.net",
                remoteJid: "status@broadcast"
            },
            message: {
                contactMessage: {
                    displayName: "𝚂𝙸𝙻𝙰-𝙼𝙳🐢",
                    vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:Meta\nORG:META AI;\nTEL;type=CELL;type=VOICE;waid=254101022551:+254101022551\nEND:VCARD`
                }
            }
        };

        try {
            switch (command) {
                case 'alive': {
                    try {
                        await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });
                        const startTime = socketCreationTime.get(number) || Date.now();
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);

                        const captionText = `
*╭━━━〔 🐢 𝚂𝙸𝙻𝙰 𝙼𝙳 🐢 〕━━━┈⊷*
*┃🐢│ 𝙱𝙾𝚃 𝙽𝙰𝙼𝙴 : 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*
*┃🐢│ 𝙱𝙾𝚃 𝚄𝙿𝚃𝙸𝙼𝙴: ${hours}ʜ ${minutes}ᴍ ${seconds}s*
*┃🐢│ 𝙰𝙲𝚃𝙸𝚅𝙴 𝙱𝙾𝚃𝚂: ${activeSockets.size}*
*┃🐢│ 𝚈𝙾𝚄𝚁 𝙽𝚄𝙼𝙱𝙴𝚁: ${number}*
*┃🐢│ 𝚅𝙴𝚁𝚂𝙸𝙾𝙽: ${config.version}*
*┃🐢│ 𝙼𝙴𝙼𝙾𝚁𝚈 𝚄𝚂𝙰𝙶𝙴: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}ᴍʙ*
*╰━━━━━━━━━━━━━━━┈⊷*
*𝚂𝙸𝙻𝙰 𝙼𝙳 𝙰𝙻𝙸𝚅𝙴 𝙽𝙾𝚆 𝙱𝙾𝚃 𝙰𝙲𝚃𝙸𝚅𝙴 𝙽𝙾𝚆 .𝙿𝙸𝙽𝙶🐢*
ʀᴇsᴘᴏɴᴅ ᴛɪᴍᴇ: ${Date.now() - msg.messageTimestamp * 1000}ms
`;

                        await socket.sendMessage(sender, {
                            image: { url: "https://files.catbox.moe/jwmx1j.jpg" },
                            caption: `> © 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🐢𝚂𝙸𝙻𝙰-𝙼𝙳\n\n${captionText}`
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Alive command error:', error);
                        const startTime = socketCreationTime.get(number) || Date.now();
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);

                        await socket.sendMessage(sender, {
                            image: { url: "https://files.catbox.moe/dlvrav.jpg" },
                            caption: `*🤖𝚂𝙸𝙻𝙰 𝙼𝙳 𝙰𝙻𝙸𝚅𝙴 𝙽𝙾𝚆*\n\n` +
                                    `*╭━━━〔 🐢 𝚂𝙸𝙻𝙰 𝙼𝙳 🐢 〕━━━┈⊷*\n` +
                                    `*┃🐢│ 𝚄𝙿𝚃𝙸𝙼𝙴: ${hours}ʜ ${minutes}ᴍ ${seconds}s*\n` +
                                    `*┃🐢│ 𝚂𝚃𝙰𝚃𝚄𝚂: 𝙾𝙽𝙻𝙸𝙽𝙴*\n` +
                                    `*┃🐢│ 𝙽𝚄𝙼𝙱𝙴𝚁: ${number}*\n` +
                                    `*┃🐢│ 𝚅𝙴𝚁𝚂𝙸𝙾𝙽: ${config.version}*\n` +
                                    `*╰━━━━━━━━━━━━━━━┈⊷*\n\n` +
                                    `𝚃𝚢𝚙𝚎 *${config.PREFIX}𝚖𝚎𝚗𝚞* 𝚏𝚘𝚛 𝚌𝚘𝚖𝚖𝚊𝚗𝚍𝚜`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'bot_stats': {
                    try {
                        const from = m.key.remoteJid;
                        const startTime = socketCreationTime.get(number) || Date.now();
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);
                        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                        const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
                        const activeCount = activeSockets.size;

                        const captionText = `
*╭━━━〔 🐢 𝚂𝙸𝙻𝙰 𝙼𝙳 🐢 〕━━━┈⊷*
*┃🐢│ 𝚄𝙿𝚃𝙸𝙼𝙴: ${hours}ʜ ${minutes}ᴍ ${seconds}s*
*┃🐢│ 𝙼𝙴𝙼𝙾𝚁𝚈: ${usedMemory}ᴍʙ / ${totalMemory}ᴍʙ*
*┃🐢│ 𝙰𝙲𝚃𝙸𝚅𝙴 𝚄𝚂𝙴𝚁𝚂: ${activeCount}*
*┃🐢│ 𝚈𝙾𝚄𝚁 𝙽𝚄𝙼𝙱𝙴𝚁: ${number}*
*┃🐢│ 𝚅𝙴𝚁𝚂𝙸𝙾𝙽: ${config.version}*
*╰━━━━━━━━━━━━━━━┈⊷*`;

                        await socket.sendMessage(from, {
                            image: { url: "https://files.catbox.moe/jwmx1j.jpg" },
                            caption: captionText
                        }, { quoted: m });
                    } catch (error) {
                        console.error('Bot stats error:', error);
                        const from = m.key.remoteJid;
                        await socket.sendMessage(from, { 
                            text: '*❌ 𝙵𝚊𝚒𝚕𝚎𝚍 𝚝𝚘 𝚛𝚎𝚝𝚛𝚒𝚎𝚟𝚎 𝚜𝚝𝚊𝚝𝚜. 𝙿𝚕𝚎𝚊𝚜𝚎 𝚝𝚛𝚢 𝚊𝚐𝚊𝚒𝚗 𝚕𝚊𝚝𝚎𝚛.*' 
                        }, { quoted: m });
                    }
                    break;
                }

                case 'bot_info': {
                    try {
                        const from = m.key.remoteJid;
                        const captionText = `
*╭━━━〔 🐢 𝚂𝙸𝙻𝙰 𝙼𝙳 🐢 〕━━━┈⊷*
*┃🐢│ 𝙽𝙰𝙼𝙴: 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*
*┃🐢│ 𝙲𝚁𝙴𝙰𝚃𝙾𝚁: 𝚂𝙸𝙻𝙰*
*┃🐢│ 𝚅𝙴𝚁𝚂𝙸𝙾𝙽: ${config.version}*
*┃🐢│ 𝙿𝚁𝙴𝙵𝙸𝚇: ${config.PREFIX}*
*┃🐢│ 𝙳𝙴𝚂𝙲: 𝚈𝚘𝚞𝚛 𝚜𝚙𝚒𝚌𝚢 𝚆𝚑𝚊𝚝𝚜𝙰𝚙𝚙 𝚌𝚘𝚖𝚙𝚊𝚗𝚒𝚘𝚗*
*╰━━━━━━━━━━━━━━━┈⊷*`;
                        
                        await socket.sendMessage(from, {
                            image: { url: "https://files.catbox.moe/jwmx1j.jpg" },
                            caption: captionText
                        }, { quoted: m });
                    } catch (error) {
                        console.error('Bot info error:', error);
                        const from = m.key.remoteJid;
                        await socket.sendMessage(from, { text: '*❌ 𝙵𝚊𝚒𝚕𝚎𝚍 𝚝𝚘 𝚛𝚎𝚝𝚛𝚒𝚎𝚟𝚎 𝚋𝚘𝚝 𝚒𝚗𝚏𝚘.*' }, { quoted: m });
                    }
                    break;
                }

                case 'menu': {
                    try {
                        await socket.sendMessage(sender, { react: { text: '🤖', key: msg.key } });
                        const startTime = socketCreationTime.get(number) || Date.now();
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);
                        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                        const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
                        
                        let menuText = ` 
*╭━━━〔 🐢 𝚂𝙸𝙻𝙰 𝙼𝙳 🐢 〕━━━┈⊷*
*┃🐢│ 𝙱𝙾𝚃 : 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*
*┃🐢│ 𝚄𝚂𝙴𝚁: @${sender.split("@")[0]}*
*┃🐢│ 𝙿𝚁𝙴𝙵𝙸𝚇: ${config.PREFIX}*
*┃🐢│ 𝚄𝙿𝚃𝙸𝙼𝙴: ${hours}ʜ ${minutes}ᴍ ${seconds}s*
*┃🐢│ 𝙼𝙴𝙼𝙾𝚁𝚈 : ${usedMemory}𝙼𝙱/${totalMemory}ᴍʙ*
*┃🐢│ 𝙲𝙾𝙼𝙼𝙰𝙽𝙳𝚂: ${count}*
*┃🐢│ 𝙳𝙴𝚅: 𝚂𝙸𝙻𝙰*
*╰━━━━━━━━━━━━━━━┈⊷*


*╭━━━〔 🐢 𝙶𝙴𝙽𝙴𝚁𝙰𝙻 𝙼𝙴𝙽𝚄 🐢 〕━━━┈⊷*
*┃🐢│ ❮✦❯ 𝚊𝚕𝚒𝚟𝚎*
*┃🐢│ ❮✦❯ 𝚋𝚛𝚘𝚊𝚍𝚌𝚊𝚜𝚝*
*┃🐢│ ❮✦❯ 𝚘𝚠𝚗𝚎𝚛*
*┃🐢│ ❮✦❯ 𝚋𝚘𝚝_𝚜𝚝𝚊𝚝𝚜*
*┃🐢│ ❮✦❯ 𝚋𝚘𝚝_𝚒𝚗𝚏𝚘*
*┃🐢│ ❮✦❯ 𝚖𝚎𝚗𝚞*
*┃🐢│ ❮✦❯ 𝚊𝚕𝚕𝚖𝚎𝚗𝚞*
*┃🐢│ ❮✦❯ 𝚙𝚒𝚗𝚐*
*┃🐢│ ❮✦❯ 𝚌𝚘𝚍𝚎*
*┃🐢│ ❮✦❯ 𝚏𝚊𝚗𝚌𝚢*
*┃🐢│ ❮✦❯ 𝚕𝚘𝚐𝚘*
*┃🐢│ ❮✦❯ 𝚚𝚛*
*╰━━━━━━━━━━━━━━━┈⊷*

*╭━━━〔 🐢 𝙳𝙾𝚆𝙽𝙻𝙾𝙰𝙳 𝙼𝙴𝙽𝚄 🐢 〕━━━┈⊷*
*┃🐢│ ❮✦❯ 𝚜𝚘𝚗𝚐*
*┃🐢│ ❮✦❯ 𝚝𝚒𝚔𝚝𝚘𝚔*
*┃🐢│ ❮✦❯ 𝚏𝚋*
*┃🐢│ ❮✦❯ 𝚒𝚐*
*┃🐢│ ❮✦❯ 𝚊𝚒𝚒𝚖𝚐*
*┃🐢│ ❮✦❯ 𝚟𝚒𝚎𝚠𝚘𝚗𝚌𝚎*
*┃🐢│ ❮✦❯ 𝚝𝚝𝚜*
*┃🐢│ ❮✦❯ 𝚝𝚜*
*┃🐢│ ❮✦❯ 𝚜𝚝𝚒𝚌𝚔𝚎𝚛*
*╰━━━━━━━━━━━━━━━┈⊷*

*╭━━━〔 🐢 𝙶𝚁𝙾𝚄𝙿 𝙼𝙴𝙽𝚄 🐢 〕━━━┈⊷*
*┃🐢│ ❮✦❯ 𝚊𝚍𝚍*
*┃🐢│ ❮✦❯ 𝚜𝚎𝚝𝚗𝚊𝚖𝚎*
*┃🐢│ ❮✦❯ 𝚠𝚊𝚛𝚗*
*┃🐢│ ❮✦❯ 𝚔𝚒𝚌𝚔*
*┃🐢│ ❮✦❯ 𝚘𝚙𝚎𝚗*
*┃🐢│ ❮✦❯ 𝚔𝚒𝚌𝚔𝚊𝚕𝚕*
*┃🐢│ ❮✦❯ 𝚌𝚕𝚘𝚜𝚎*
*┃🐢│ ❮✦❯ 𝚒𝚗𝚟𝚒𝚝𝚎*
*┃🐢│ ❮✦❯ 𝚙𝚛𝚘𝚖𝚘𝚝𝚎*
*┃🐢│ ❮✦❯ 𝚍𝚎𝚖𝚘𝚝𝚎*
*┃🐢│ ❮✦❯ 𝚝𝚊𝚐𝚊𝚕𝚕*
*┃🐢│ ❮✦❯ 𝚓𝚘𝚒𝚗*
*╰━━━━━━━━━━━━━━━┈⊷*

*╭━━━〔 🐢 𝙵𝙰𝙽 𝙼𝙴𝙽𝚄 🐢 〕━━━┈⊷*
*┃🐢│ ❮✦❯ 𝚓𝚘𝚔𝚎*
*┃🐢│ ❮✦❯ 𝚍𝚊𝚛𝚔𝚓𝚘𝚔𝚎*
*┃🐢│ ❮✦❯ 𝚠𝚊𝚒𝚏𝚞*
*┃🐢│ ❮✦❯ 𝚖𝚎𝚖𝚎*
*┃🐢│ ❮✦❯ 𝚌𝚊𝚝*
*┃🐢│ ❮✦❯ 𝚍𝚘𝚐*
*┃🐢│ ❮✦❯ 𝚏𝚊𝚌𝚝*
*┃🐢│ ❮✦❯ 𝚙𝚒𝚌𝚔𝚞𝚙𝚕𝚒𝚗𝚎*
*┃🐢│ ❮✦❯ 𝚛𝚘𝚊𝚜𝚝*
*┃🐢│ ❮✦❯ 𝚕𝚘𝚟𝚎𝚚𝚞𝚘𝚝𝚎*
*┃🐢│ ❮✦❯ 𝚚𝚞𝚘𝚝𝚎*
*╰━━━━━━━━━━━━━━━┈⊷*

*╭━━━〔 🐢 𝙼𝙰𝙸𝙽 𝙼𝙴𝙽𝚄 🐢 〕━━━┈⊷*
*┃🐢│ ❮✦❯ 𝚊𝚒*
*┃🐢│ ❮✦❯ 𝚠𝚒𝚗𝚏𝚘*
*┃🐢│ ❮✦❯ 𝚠𝚑𝚘𝚒𝚜*
*┃🐢│ ❮✦❯ 𝚋𝚘𝚖𝚋*
*┃🐢│ ❮✦❯ 𝚐𝚎𝚝𝚙𝚙*
*┃🐢│ ❮✦❯ 𝚜𝚊𝚟𝚎𝚜𝚝𝚊𝚝𝚞𝚜*
*┃🐢│ ❮✦❯ 𝚜𝚎𝚝𝚜𝚝𝚊𝚝𝚞𝚜*
*┃🐢│ ❮✦❯ 𝚍𝚎𝚕𝚎𝚝𝚎𝚖𝚎*
*┃🐢│ ❮✦❯ 𝚠𝚎𝚊𝚝𝚑𝚎𝚛*
*┃🐢│ ❮✦❯ 𝚜𝚑𝚘𝚛𝚝𝚞𝚛𝚕*
*┃🐢│ ❮✦❯ 𝚝𝚘𝚞𝚛𝚕𝟸*
*┃🐢│ ❮✦❯ 𝚊𝚙𝚔*
*┃🐢│ ❮✦❯ 𝚏𝚌*
*╰━━━━━━━━━━━━━━━┈⊷*

*Ξ 𝚂𝙴𝙻𝙴𝙲𝚃 𝙲𝙾𝙼𝙼𝙰𝙽𝙳𝙴𝚁 𝙻𝙸𝚂𝚃:*

>  © 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🐢𝚂𝙸𝙻𝙰-𝙼𝙳
`;

                        await socket.sendMessage(from, {
                            image: { url: "https://files.catbox.moe/jwmx1j.jpg" },
                            caption: `*𝚂𝙸𝙻𝙰 𝙼𝙳*\n${menuText}`
                        }, { quoted: fakevCard });
                        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
                    } catch (error) {
                        console.error('Menu command error:', error);
                        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                        const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
                        let fallbackMenuText = `
*╭━━━〔 🐢 𝚂𝙸𝙻𝙰 𝙼𝙳 🐢 〕━━━┈⊷*
*┃🐢│ 𝙱𝙾𝚃 : 𝚂𝙸𝙻𝙰 𝙼𝙳*
*┃🐢│ 𝚄𝚂𝙴𝚁: @${sender.split("@")[0]}*
*┃🐢│ 𝙿𝚁𝙴𝙵𝙸𝚇: ${config.PREFIX}*
*┃🐢│ 𝙼𝙴𝙼𝙾𝚁𝚈 : ${usedMemory}𝙼𝙱/${totalMemory}ᴍʙ*
*┃🐢│ 𝙼𝙴𝙼𝙾𝚁𝚈: ${usedMemory}𝙼𝙱/${totalMemory}ᴍʙ*
*╰━━━━━━━━━━━━━━━┈⊷*

${config.PREFIX}𝙰𝙻𝙻 𝙼𝙴𝙽𝚄 𝚃𝙾 𝚅𝙸𝙴𝚆 𝙰𝙻𝙻 𝙲𝙾𝙼𝙼𝙰𝙽𝙳🐢❳
> *© 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🐢𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸 𝙱𝙾𝚃*
`;

                        await socket.sendMessage(from, {
                            image: { url: "https://files.catbox.moe/jwmx1j.jpg" },
                            caption: fallbackMenuText
                        }, { quoted: fakevCard });
                        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                    }
                    break;
                }

                case 'allmenu': {
                    try {
                        await socket.sendMessage(sender, { react: { text: '📜', key: msg.key } });
                        const startTime = socketCreationTime.get(number) || Date.now();
                        const uptime = Math.floor((Date.now() - startTime) / 1000);
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);
                        const usedMemory = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
                        const totalMemory = Math.round(os.totalmem() / 1024 / 1024);
                        

                        let allMenuText = `
*╭━━━〔 🐢 𝚂𝙸𝙻𝙰 𝙼𝙳 🐢 〕━━━┈⊷*
*┃🐢│ 𝙱𝙾𝚃 : 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸*
*┃🐢│ 𝚄𝚂𝙴𝚁: @${sender.split("@")[0]}*
*┃🐢│ 𝙿𝚁𝙴𝙵𝙸𝚇: ${config.PREFIX}*
*┃🐢│ 𝚄𝙿𝚃𝙸𝙼𝙴: ${hours}ʜ ${minutes}ᴍ ${seconds}s*
*┃🐢│ 𝙼𝙴𝙼𝙾𝚁𝚈 : ${usedMemory}𝙼𝙱/${totalMemory}ᴍʙ*
*┃🐢│ 𝙲𝙾𝙼𝙼𝙰𝙽𝙳𝚂: ${count}*
*┃🐢│ 𝙳𝙴𝚅: 𝚂𝙸𝙻𝙰*
*╰━━━━━━━━━━━━━━━┈⊷*


*╭━━━〔 🐢 𝙶𝙴𝙽𝙴𝚁𝙰𝙻 𝙼𝙴𝙽𝚄 🐢 〕━━━┈⊷*
*┃🐢│ ❮✦❯ 𝚊𝚕𝚒𝚟𝚎*
*┃🐢│ ❮✦❯ 𝚋𝚛𝚘𝚊𝚍𝚌𝚊𝚜𝚝*
*┃🐢│ ❮✦❯ 𝚘𝚠𝚗𝚎𝚛*
*┃🐢│ ❮✦❯ 𝚋𝚘𝚝_𝚜𝚝𝚊𝚝𝚜*
*┃🐢│ ❮✦❯ 𝚋𝚘𝚝_𝚒𝚗𝚏𝚘*
*┃🐢│ ❮✦❯ 𝚖𝚎𝚗𝚞*
*┃🐢│ ❮✦❯ 𝚊𝚕𝚕𝚖𝚎𝚗𝚞*
*┃🐢│ ❮✦❯ 𝚙𝚒𝚗𝚐*
*┃🐢│ ❮✦❯ 𝚌𝚘𝚍𝚎*
*┃🐢│ ❮✦❯ 𝚏𝚊𝚗𝚌𝚢*
*┃🐢│ ❮✦❯ 𝚕𝚘𝚐𝚘*
*┃🐢│ ❮✦❯ 𝚚𝚛*
*╰━━━━━━━━━━━━━━━┈⊷*

*╭━━━〔 🐢 𝙳𝙾𝚆𝙽𝙻𝙾𝙰𝙳 𝙼𝙴𝙽𝚄 🐢 〕━━━┈⊷*
*┃🐢│ ❮✦❯ 𝚜𝚘𝚗𝚐*
*┃🐢│ ❮✦❯ 𝚝𝚒𝚔𝚝𝚘𝚔*
*┃🐢│ ❮✦❯ 𝚏𝚋*
*┃🐢│ ❮✦❯ 𝚒𝚐*
*┃🐢│ ❮✦❯ 𝚊𝚒𝚒𝚖𝚐*
*┃🐢│ ❮✦❯ 𝚟𝚒𝚎𝚠𝚘𝚗𝚌𝚎*
*┃🐢│ ❮✦❯ 𝚝𝚝𝚜*
*┃🐢│ ❮✦❯ 𝚝𝚜*
*┃🐢│ ❮✦❯ 𝚜𝚝𝚒𝚌𝚔𝚎𝚛*
*╰━━━━━━━━━━━━━━━┈⊷*

*╭━━━〔 🐢 𝙶𝚁𝙾𝚄𝙿 𝙼𝙴𝙽𝚄 🐢 〕━━━┈⊷*
*┃🐢│ ❮✦❯ 𝚊𝚍𝚍*
*┃🐢│ ❮✦❯ 𝚜𝚎𝚝𝚗𝚊𝚖𝚎*
*┃🐢│ ❮✦❯ 𝚠𝚊𝚛𝚗*
*┃🐢│ ❮✦❯ 𝚔𝚒𝚌𝚔*
*┃🐢│ ❮✦❯ 𝚘𝚙𝚎𝚗*
*┃🐢│ ❮✦❯ 𝚔𝚒𝚌𝚔𝚊𝚕𝚕*
*┃🐢│ ❮✦❯ 𝚌𝚕𝚘𝚜𝚎*
*┃🐢│ ❮✦❯ 𝚒𝚗𝚟𝚒𝚝𝚎*
*┃🐢│ ❮✦❯ 𝚙𝚛𝚘𝚖𝚘𝚝𝚎*
*┃🐢│ ❮✦❯ 𝚍𝚎𝚖𝚘𝚝𝚎*
*┃🐢│ ❮✦❯ 𝚝𝚊𝚐𝚊𝚕𝚕*
*┃🐢│ ❮✦❯ 𝚓𝚘𝚒𝚗*
*╰━━━━━━━━━━━━━━━┈⊷*

*╭━━━〔 🐢 𝙵𝙰𝙽 𝙼𝙴𝙽𝚄 🐢 〕━━━┈⊷*
*┃🐢│ ❮✦❯ 𝚓𝚘𝚔𝚎*
*┃🐢│ ❮✦❯ 𝚍𝚊𝚛𝚔𝚓𝚘𝚔𝚎*
*┃🐢│ ❮✦❯ 𝚠𝚊𝚒𝚏𝚞*
*┃🐢│ ❮✦❯ 𝚖𝚎𝚖𝚎*
*┃🐢│ ❮✦❯ 𝚌𝚊𝚝*
*┃🐢│ ❮✦❯ 𝚍𝚘𝚐*
*┃🐢│ ❮✦❯ 𝚏𝚊𝚌𝚝*
*┃🐢│ ❮✦❯ 𝚙𝚒𝚌𝚔𝚞𝚙𝚕𝚒𝚗𝚎*
*┃🐢│ ❮✦❯ 𝚛𝚘𝚊𝚜𝚝*
*┃🐢│ ❮✦❯ 𝚕𝚘𝚟𝚎𝚚𝚞𝚘𝚝𝚎*
*┃🐢│ ❮✦❯ 𝚚𝚞𝚘𝚝𝚎*
*╰━━━━━━━━━━━━━━━┈⊷*

*╭━━━〔 🐢 𝙼𝙰𝙸𝙽 𝙼𝙴𝙽𝚄 🐢 〕━━━┈⊷*
*┃🐢│ ❮✦❯ 𝚊𝚒*
*┃🐢│ ❮✦❯ 𝚠𝚒𝚗𝚏𝚘*
*┃🐢│ ❮✦❯ 𝚠𝚑𝚘𝚒𝚜*
*┃🐢│ ❮✦❯ 𝚋𝚘𝚖𝚋*
*┃🐢│ ❮✦❯ 𝚐𝚎𝚝𝚙𝚙*
*┃🐢│ ❮✦❯ 𝚜𝚊𝚟𝚎𝚜𝚝𝚊𝚝𝚞𝚜*
*┃🐢│ ❮✦❯ 𝚜𝚎𝚝𝚜𝚝𝚊𝚝𝚞𝚜*
*┃🐢│ ❮✦❯ 𝚍𝚎𝚕𝚎𝚝𝚎𝚖𝚎*
*┃🐢│ ❮✦❯ 𝚠𝚎𝚊𝚝𝚑𝚎𝚛*
*┃🐢│ ❮✦❯ 𝚜𝚑𝚘𝚛𝚝𝚞𝚛𝚕*
*┃🐢│ ❮✦❯ 𝚝𝚘𝚞𝚛𝚕𝟸*
*┃🐢│ ❮✦❯ 𝚊𝚙𝚔*
*┃🐢│ ❮✦❯ 𝚏𝚌*
*╰━━━━━━━━━━━━━━━┈⊷*



> *© 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🐢𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸 𝙱𝙾𝚃*
`;

                        await socket.sendMessage(from, {
                            image: { url: "https://files.catbox.moe/jwmx1j.jpg" },
                            caption: allMenuText
                        }, { quoted: fakevCard });
                        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
                    } catch (error) {
                        console.error('Allmenu command error:', error);
                        await socket.sendMessage(from, {
                            text: `*❌ 𝚝𝚑𝚎 𝚖𝚎𝚗𝚞 𝚐𝚘𝚝 𝚜𝚑𝚢! 😢*\nError: ${error.message || 'Unknown error'}\nTry again, love?`
                        }, { quoted: fakevCard });
                        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                    }
                    break;
                }

                case 'ping': {
                    await socket.sendMessage(sender, { react: { text: '📍', key: msg.key } });
                    try {
                        const startTime = new Date().getTime();
                        await socket.sendMessage(sender, { 
                            text: '*𝚂𝙸𝙻𝙰 𝙼𝙳 𝙿𝙸𝙽𝙶🐢*'
                        }, { quoted: msg });

                        const endTime = new Date().getTime();
                        const latency = endTime - startTime;

                        let quality = '';
                        let emoji = '';
                        if (latency < 100) {
                            quality = '𝚎𝚡𝚌𝚎𝚕𝚕𝚎𝚗𝚝';
                            emoji = '🟢';
                        } else if (latency < 300) {
                            quality = '𝚐𝚘𝚘𝚍';
                            emoji = '🟡';
                        } else if (latency < 600) {
                            quality = '𝚏𝚊𝚒𝚛';
                            emoji = '🟠';
                        } else {
                            quality = '𝚙𝚘𝚘𝚛';
                            emoji = '🔴';
                        }

                        const finalMessage = `*╭━━━〔 🐢 𝚂𝙸𝙻𝙰 𝙼𝙳 🐢 〕━━━┈⊷*\n*┃🐢│*\n*┃🐢│ 🏓 𝙿𝙸𝙽𝙶 𝚁𝙴𝚂𝚄𝙻𝚃𝚂*\n*┃🐢│*\n*┃🐢│ ⚡ 𝚂𝚙𝚎𝚎𝚍: ${latency}𝚖𝚜*\n*┃🐢│ ${emoji} 𝚀𝚞𝚊𝚕𝚒𝚝𝚢: ${quality}*\n*┃🐢│ 🕒 𝚃𝚒𝚖𝚎: ${new Date().toLocaleString()}*\n*┃🐢│*\n*╰━━━━━━━━━━━━━━━┈⊷*\n> 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸`;

                        await socket.sendMessage(sender, { text: finalMessage }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Ping command error:', error);
                        const startTime = new Date().getTime();
                        await socket.sendMessage(sender, { 
                            text: '*🐢𝚂𝙸𝙻𝙰 𝙼𝙳 𝙿𝙸𝙽𝙶*'
                        }, { quoted: msg });
                        const endTime = new Date().getTime();
                        await socket.sendMessage(sender, { 
                            text: `*╭━━━〔 🐢 𝚂𝙸𝙻𝙰 𝙼𝙳 🐢 〕━━━┈⊷*\n*┃🐢│*\n*┃🐢│ 🏓 𝙿𝚒𝚗𝚐: ${endTime - startTime}𝚖𝚜*\n*┃🐢│*\n*╰━━━━━━━━━━━━━━━┈⊷*`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'pair': {
                    await socket.sendMessage(sender, { react: { text: '📲', key: msg.key } });
                    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
                    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

                    const q = msg.message?.conversation ||
                            msg.message?.extendedTextMessage?.text ||
                            msg.message?.imageMessage?.caption ||
                            msg.message?.videoMessage?.caption || '';

                    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();

                    if (!number) {
                        return await socket.sendMessage(sender, {
                            text: '*📌 𝚞𝚜𝚊𝚐𝚎:* .pair +947858xxxxx'
                        }, { quoted: msg });
                    }

                    try {
                        const url = `https://mini-stacy-xd-be3k.onrender.com/code?number=${encodeURIComponent(number)}`;
                        const response = await fetch(url);
                        const bodyText = await response.text();

                        console.log("🌐 API Response:", bodyText);

                        let result;
                        try {
                            result = JSON.parse(bodyText);
                        } catch (e) {
                            console.error("❌ JSON Parse Error:", e);
                            return await socket.sendMessage(sender, {
                                text: '*❌ 𝙸𝚗𝚟𝚊𝚕𝚒𝚍 𝚛𝚎𝚜𝚙𝚘𝚗𝚜𝚎 𝚏𝚛𝚘𝚖 𝚜𝚎𝚛𝚟𝚎𝚛. 𝙿𝚕𝚎𝚊𝚜𝚎 𝚌𝚘𝚗𝚝𝚊𝚌𝚝 𝚜𝚞𝚙𝚙𝚘𝚛𝚝.*'
                            }, { quoted: msg });
                        }

                        if (!result || !result.code) {
                            return await socket.sendMessage(sender, {
                                text: '*❌ 𝙵𝚊𝚒𝚕𝚎𝚍 𝚝𝚘 𝚛𝚎𝚝𝚛𝚒𝚎𝚟𝚎 𝚙𝚊𝚒𝚛𝚒𝚗𝚐 𝚌𝚘𝚍𝚎. 𝙿𝚕𝚎𝚊𝚜𝚎 𝚌𝚑𝚎𝚌𝚔 𝚝𝚑𝚎 𝚗𝚞𝚖𝚋𝚎𝚛.*'
                            }, { quoted: msg });
                        }

                        await socket.sendMessage(sender, {
                            text: `> *𝚂𝙸𝙻𝙰-𝙼𝙳 𝚙𝚊𝚒𝚛 𝚌𝚘𝚖𝚙𝚕𝚎𝚝𝚎𝚍* ✅\n\n*🔑 𝚢𝚘𝚞𝚛 𝚙𝚊𝚒𝚛𝚒𝚗𝚐 𝚌𝚘𝚍𝚎 𝚒𝚜:* ${result.code}`
                        }, { quoted: msg });

                        await sleep(2000);

                        await socket.sendMessage(sender, {
                            text: `${result.code}`
                        }, { quoted: fakevCard });

                    } catch (err) {
                        console.error("❌ Pair Command Error:", err);
                        await socket.sendMessage(sender, {
                            text: '*❌ 𝙾𝚑, 𝚍𝚊𝚛𝚕𝚒𝚗𝚐, 𝚜𝚘𝚖𝚎𝚝𝚑𝚒𝚗𝚐 𝚋𝚛𝚘𝚔𝚎 𝚖𝚢 𝚑𝚎𝚊𝚛𝚝 💔 𝚃𝚛𝚢 𝚊𝚐𝚊𝚒𝚗 𝚕𝚊𝚝𝚎𝚛?*'
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'viewonce':
                case 'rvo':
                case 'vv': {
                    await socket.sendMessage(sender, { react: { text: '✨', key: msg.key } });

                    try {
                        if (!msg.quoted) {
                            return await socket.sendMessage(sender, {
                                text: `*🚩 𝚙𝚕𝚎𝚊𝚜𝚎 𝚛𝚎𝚙𝚕𝚢 𝚝𝚘 𝚊 𝚟𝚒𝚎𝚠-𝚘𝚗𝚌𝚎 𝚖𝚎𝚜𝚜𝚊𝚐𝚎*\n\n` +
                                      `*📝 𝚑𝚘𝚠 𝚝𝚘 𝚞𝚜𝚎:*\n` +
                                      `• 𝚛𝚎𝚙𝚕𝚢 𝚝𝚘 𝚊 𝚟𝚒𝚎𝚠-𝚘𝚗𝚌𝚎 𝚒𝚖𝚊𝚐𝚎, 𝚟𝚒𝚍𝚎𝚘, 𝚘𝚛 𝚊𝚞𝚍𝚒𝚘\n` +
                                      `• 𝚞𝚜𝚎: ${config.PREFIX}vv\n` +
                                      `• 𝚒'𝚕𝚕 𝚛𝚎𝚟𝚎𝚊𝚕 𝚝𝚑𝚎 𝚑𝚒𝚍𝚍𝚎𝚗 𝚝𝚛𝚎𝚊𝚜𝚞𝚛𝚎 𝚏𝚘𝚛 𝚢𝚘𝚞`
                            });
                        }

                        const contextInfo = msg.msg?.contextInfo;
                        const quotedMessage = msg.quoted?.message || 
                                             contextInfo?.quotedMessage || 
                                             (contextInfo?.stanzaId ? await getQuotedMessage(contextInfo.stanzaId) : null);

                        if (!quotedMessage) {
                            return await socket.sendMessage(sender, {
                                text: `*❌ 𝚒 𝚌𝚊𝚗'𝚝 𝚏𝚒𝚗𝚍 𝚝𝚑𝚊𝚝 𝚑𝚒𝚍𝚍𝚎𝚗 𝚐𝚎𝚖, 𝚕𝚘𝚟𝚎 😢*\n\n` +
                                      `𝚙𝚕𝚎𝚊𝚜𝚎 𝚝𝚛𝚢:\n` +
                                      `• 𝚛𝚎𝚙𝚕𝚢 𝚍𝚒𝚛𝚎𝚌𝚝𝚕𝚢 𝚝𝚘 𝚝𝚑𝚎 𝚟𝚒𝚎𝚠-𝚘𝚗𝚌𝚎 𝚖𝚎𝚜𝚜𝚊𝚐𝚎\n` +
                                      `• 𝚖𝚊𝚔𝚎 𝚜𝚞𝚛𝚎 𝚒𝚝 𝚑𝚊𝚜𝚗'𝚝 𝚟𝚊𝚗𝚒𝚜𝚑𝚎𝚍!`
                            });
                        }

                        let fileType = null;
                        let mediaMessage = null;
                        
                        if (quotedMessage.viewOnceMessageV2) {
                            const messageContent = quotedMessage.viewOnceMessageV2.message;
                            if (messageContent.imageMessage) {
                                fileType = 'image';
                                mediaMessage = messageContent.imageMessage;
                            } else if (messageContent.videoMessage) {
                                fileType = 'video';
                                mediaMessage = messageContent.videoMessage;
                            } else if (messageContent.audioMessage) {
                                fileType = 'audio';
                                mediaMessage = messageContent.audioMessage;
                            }
                        } else if (quotedMessage.viewOnceMessage) {
                            const messageContent = quotedMessage.viewOnceMessage.message;
                            if (messageContent.imageMessage) {
                                fileType = 'image';
                                mediaMessage = messageContent.imageMessage;
                            } else if (messageContent.videoMessage) {
                                fileType = 'video';
                                mediaMessage = messageContent.videoMessage;
                            }
                        } else if (quotedMessage.imageMessage?.viewOnce || 
                                   quotedMessage.videoMessage?.viewOnce || 
                                   quotedMessage.audioMessage?.viewOnce) {
                            if (quotedMessage.imageMessage?.viewOnce) {
                                fileType = 'image';
                                mediaMessage = quotedMessage.imageMessage;
                            } else if (quotedMessage.videoMessage?.viewOnce) {
                                fileType = 'video';
                                mediaMessage = quotedMessage.videoMessage;
                            } else if (quotedMessage.audioMessage?.viewOnce) {
                                fileType = 'audio';
                                mediaMessage = quotedMessage.audioMessage;
                            }
                        }

                        if (!fileType || !mediaMessage) {
                            return await socket.sendMessage(sender, {
                                text: `*⚠️ 𝚝𝚑𝚒𝚜 𝚒𝚜𝚗'𝚝 𝚊 𝚟𝚒𝚎𝚠-𝚘𝚗𝚌𝚎 𝚖𝚎𝚜𝚜𝚊𝚐𝚎*\n\n` +
                                      `𝚛𝚎𝚙𝚕𝚢 𝚝𝚘 𝚊 𝚖𝚎𝚜𝚜𝚊𝚐𝚎 𝚠𝚒𝚝𝚑 𝚑𝚒𝚍𝚍𝚎𝚗 𝚖𝚎𝚍𝚒𝚊 (𝚒𝚖𝚊𝚐𝚎, 𝚟𝚒𝚍𝚎𝚘, 𝚘𝚛 𝚊𝚞𝚍𝚒𝚘)`
                            });
                        }

                        await socket.sendMessage(sender, {
                            text: `*🔓 𝚄𝚗𝚟𝚎𝚒𝚕𝚒𝚗𝚐 𝚢𝚘𝚞𝚛 𝚜𝚎𝚌𝚛𝚎𝚝 ${fileType.toUpperCase()}...*`
                        });

                        // Download and send the media
                        const mediaBuffer = await downloadMediaMessage(
                            { 
                                key: msg.quoted.key, 
                                message: { 
                                    [fileType + 'Message']: mediaMessage 
                                } 
                            },
                            'buffer',
                            {}
                        );

                        if (!mediaBuffer) {
                            throw new Error('Failed to download media');
                        }

                        const mimetype = mediaMessage.mimetype || 
                                        (fileType === 'image' ? 'image/jpeg' : 
                                         fileType === 'video' ? 'video/mp4' : 'audio/mpeg');
                        
                        const extension = mimetype.split('/')[1];
                        const filename = `revealed-${fileType}-${Date.now()}.${extension}`;

                        let messageOptions = {
                            caption: `*✨ 𝚁𝚎𝚟𝚎𝚊𝚕𝚎𝚍 ${fileType.toUpperCase()}* - 𝚢𝚘𝚞'𝚛𝚎 𝚠𝚎𝚕𝚌𝚘𝚖𝚎`
                        };

                        if (fileType === 'image') {
                            await socket.sendMessage(sender, {
                                image: mediaBuffer,
                                ...messageOptions
                            });
                        } else if (fileType === 'video') {
                            await socket.sendMessage(sender, {
                                video: mediaBuffer,
                                ...messageOptions
                            });
                        } else if (fileType === 'audio') {
                            await socket.sendMessage(sender, {
                                audio: mediaBuffer,
                                ...messageOptions,
                                mimetype: mimetype
                            });
                        }

                        await socket.sendMessage(sender, {
                            react: { text: '✅', key: msg.key }
                        });
                    } catch (error) {
                        console.error('ViewOnce command error:', error);
                        let errorMessage = `*❌ 𝚘𝚑 𝚗𝚘, 𝚒 𝚌𝚘𝚞𝚕𝚍𝚗'𝚝 𝚞𝚗𝚟𝚎𝚒𝚕 𝚒𝚝*\n\n`;

                        if (error.message?.includes('decrypt') || error.message?.includes('protocol')) {
                            errorMessage += `*🔒 𝙳𝚎𝚌𝚛𝚢𝚙𝚝𝚒𝚘𝚗 𝚏𝚊𝚒𝚕𝚎𝚍* - 𝚝𝚑𝚎 𝚜𝚎𝚌𝚛𝚎𝚝'𝚜 𝚝𝚘𝚘 𝚍𝚎𝚎𝚙!`;
                        } else if (error.message?.includes('download') || error.message?.includes('buffer')) {
                            errorMessage += `*📥 𝙳𝚘𝚠𝚗𝚕𝚘𝚊𝚍 𝚏𝚊𝚒𝚕𝚎𝚍* - 𝚌𝚑𝚎𝚌𝚔 𝚢𝚘𝚞𝚛 𝚌𝚘𝚗𝚗𝚎𝚌𝚝𝚒𝚘𝚗.`;
                        } else if (error.message?.includes('expired') || error.message?.includes('old')) {
                            errorMessage += `*⏰ 𝙼𝚎𝚜𝚜𝚊𝚐𝚎 𝚎𝚡𝚙𝚒𝚛𝚎𝚍* - 𝚝𝚑𝚎 𝚖𝚊𝚐𝚒𝚌'𝚜 𝚐𝚘𝚗𝚎!`;
                        } else {
                            errorMessage += `*🐛 𝙴𝚛𝚛𝚘𝚛:* ${error.message || '𝚜𝚘𝚖𝚎𝚝𝚑𝚒𝚗𝚐 𝚠𝚎𝚗𝚝 𝚠𝚛𝚘𝚗𝚐'}`;
                        }

                        errorMessage += `\n\n*💡 𝚝𝚛𝚢:*\n• 𝚞𝚜𝚒𝚗𝚐 𝚊 𝚏𝚛𝚎𝚜𝚑 𝚟𝚒𝚎𝚠-𝚘𝚗𝚌𝚎 𝚖𝚎𝚜𝚜𝚊𝚐𝚎\n• 𝚌𝚑𝚎𝚌𝚔𝚒𝚗𝚐 𝚢𝚘𝚞𝚛 𝚒𝚗𝚝𝚎𝚛𝚗𝚎𝚝 𝚌𝚘𝚗𝚗𝚎𝚌𝚝𝚒𝚘𝚗`;

                        await socket.sendMessage(sender, { text: errorMessage });
                        await socket.sendMessage(sender, {
                            react: { text: '❌', key: msg.key }
                        });
                    }
                    break;
                }

                case 'play':
                case 'song': {
                    const yts = require('yt-search');
                    const ddownr = require('denethdev-ytmp3');
                    const fs = require('fs').promises;
                    const path = require('path');
                    const { exec } = require('child_process');
                    const util = require('util');
                    const execPromise = util.promisify(exec);
                    const { existsSync, mkdirSync } = require('fs');

                    const TEMP_DIR = './temp';
                    const MAX_FILE_SIZE_MB = 4;
                    const TARGET_SIZE_MB = 3.8;

                    if (!existsSync(TEMP_DIR)) {
                        mkdirSync(TEMP_DIR, { recursive: true });
                    }

                    function extractYouTubeId(url) {
                        const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
                        const match = url.match(regex);
                        return match ? match[1] : null;
                    }

                    function convertYouTubeLink(input) {
                        const videoId = extractYouTubeId(input);
                        return videoId ? `https://www.youtube.com/watch?v=https://api-faa.my.id/faa/ytmp3${videoId}` : input;
                    }

                    function formatDuration(seconds) {
                        const minutes = Math.floor(seconds / 60);
                        const remainingSeconds = Math.floor(seconds % 60);
                        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
                    }

                    async function compressAudio(inputPath, outputPath, targetSizeMB = TARGET_SIZE_MB) {
                        try {
                            const { stdout: durationOutput } = await execPromise(
                                `ffprobe -i "${inputPath}" -show_entries format=duration -v quiet -of csv="p=0"`
                            );
                            const duration = parseFloat(durationOutput) || 180;
                            const targetBitrate = Math.floor((targetSizeMB * 8192) / duration);
                            const constrainedBitrate = Math.min(Math.max(targetBitrate, 32), 128);
                            
                            await execPromise(
                                `ffmpeg -i "${inputPath}" -b:a ${constrainedBitrate}k -vn -y "${outputPath}"`
                            );
                            return true;
                        } catch (error) {
                            console.error('Audio compression failed:', error);
                            return false;
                        }
                    }

                    async function cleanupFiles(...filePaths) {
                        for (const filePath of filePaths) {
                            if (filePath) {
                                try {
                                    await fs.unlink(filePath);
                                } catch (err) {
                                }
                            }
                        }
                    }

                    const q = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || 
                              msg.message?.imageMessage?.caption || 
                              msg.message?.videoMessage?.caption || '';

                    if (!q || q.trim() === '') {
                        return await socket.sendMessage(sender, 
                            { text: '*`𝙶𝚒𝚟𝚎 𝚖𝚎 𝚊 𝚜𝚘𝚗𝚐 𝚝𝚒𝚝𝚕𝚎 𝚘𝚛 𝚢𝚘𝚞𝚝𝚞𝚋𝚎 𝚕𝚒𝚗𝚔`*' }, 
                            { quoted: fakevCard }
                        );
                    }

                    const fixedQuery = convertYouTubeLink(q.trim());
                    let tempFilePath = '';
                    let compressedFilePath = '';

                    try {
                        const search = await yts(fixedQuery);
                        const videoInfo = search.videos[0];
                        
                        if (!videoInfo) {
                            return await socket.sendMessage(sender, 
                                { text: '*`𝙽𝚘 𝚜𝚘𝚗𝚐𝚜 𝚏𝚘𝚞𝚗𝚍! 𝚃𝚛𝚢 𝚊𝚗𝚘𝚝𝚑𝚎𝚛`*' }, 
                                { quoted: fakevCard }
                            );
                        }

                        const formattedDuration = formatDuration(videoInfo.seconds);
                        
                        const desc = `
     *╭━━━〔 🐢 𝚂𝙸𝙻𝙰 𝙼𝙳 🐢 〕━━━┈⊷*
*┃🐢│ 𝚃𝙸𝚃𝙻𝙴: ${videoInfo.title}*
*┃🐢│ 𝙰𝚁𝚃𝙸𝚂𝚃: ${videoInfo.author.name}*
*┃🐢│ 𝙳𝚄𝚁𝙰𝚃𝙸𝙾𝙽: ${formattedDuration}*
*┃🐢│ 𝚄𝙿𝙻𝙾𝙰𝙳𝙴𝙳: ${videoInfo.ago}*
*┃🐢│ 𝚅𝙸𝙴𝚆𝚂: ${videoInfo.views.toLocaleString()}*
*┃🐢│ 𝙵𝚘𝚛𝚖𝚊𝚝: 𝙷𝚒𝚐𝚑 𝚚𝚞𝚊𝚕𝚒𝚝𝚢 𝚖𝚙𝟹*
*╰━━━━━━━━━━━━━━━┈⊷*

*© 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🐢𝚂𝙸𝙻𝙰 𝙼𝙳 𝙼𝙸𝙽𝙸 𝙱𝙾𝚃*
`;

                        await socket.sendMessage(sender, {
                            image: { url: videoInfo.thumbnail },
                            caption: desc
                        }, { quoted: fakevCard });

                        const result = await ddownr.download(videoInfo.url, 'mp3');
                        const downloadLink = result.downloadUrl;

                        const cleanTitle = videoInfo.title.replace(/[^\w\s]/gi, '').substring(0, 30);
                        tempFilePath = path.join(TEMP_DIR, `${cleanTitle}_${Date.now()}_original.mp3`);
                        compressedFilePath = path.join(TEMP_DIR, `${cleanTitle}_${Date.now()}_compressed.mp3`);

                        const response = await fetch(downloadLink);
                        const arrayBuffer = await response.arrayBuffer();
                        await fs.writeFile(tempFilePath, Buffer.from(arrayBuffer));

                        const stats = await fs.stat(tempFilePath);
                        const fileSizeMB = stats.size / (1024 * 1024);
                        
                        if (fileSizeMB > MAX_FILE_SIZE_MB) {
                            const compressionSuccess = await compressAudio(tempFilePath, compressedFilePath);
                            if (compressionSuccess) {
                                await cleanupFiles(tempFilePath);
                                tempFilePath = compressedFilePath;
                                compressedFilePath = '';
                            }
                        }

                        const audioBuffer = await fs.readFile(tempFilePath);
                        await socket.sendMessage(sender, {
                            audio: audioBuffer,
                            mimetype: "audio/mpeg",
                            fileName: `${cleanTitle}.mp3`,
                            ptt: false
                        }, { quoted: fakevCard });

                        await cleanupFiles(tempFilePath, compressedFilePath);
                        
                    } catch (err) {
                        console.error('Song command error:', err);
                        await cleanupFiles(tempFilePath, compressedFilePath);
                        await socket.sendMessage(sender, 
                            { text: "*❌ 𝚃𝚑𝚎 𝚖𝚞𝚜𝚒𝚌 𝚜𝚝𝚘𝚙𝚙𝚎𝚍 𝚝𝚛𝚢 𝚊𝚐𝚊𝚒𝚗?*" }, 
                            { quoted: fakevCard }
                        );
                    }
                    break;
                }

                case 'logo': { 
                    const q = args.join(" ");
                    
                    if (!q || q.trim() === '') {
                        return await socket.sendMessage(sender, { text: '*`𝙽𝚎𝚎𝚍 𝚊 𝚗𝚊𝚖𝚎 𝚏𝚘𝚛 𝚕𝚘𝚐𝚘`*' });
                    }

                    await socket.sendMessage(sender, { react: { text: '⬆️', key: msg.key } });
                    const list = await axios.get('https://raw.githubusercontent.com/rl6453614-droid/Sannumad/main/newsletter_list.json');

                    await socket.sendMessage(sender, {
                        text: `*🎨 𝙻𝚘𝚐𝚘 𝙼𝚊𝚔𝚎𝚛*\n\n*𝚃𝚎𝚡𝚝:* ${q}\n\n*𝙲𝚑𝚘𝚘𝚜𝚎 𝚢𝚘𝚞𝚛 𝚕𝚘𝚐𝚘 𝚜𝚝𝚢𝚕𝚎 𝚋𝚢 𝚞𝚜𝚒𝚗𝚐:*\n*.𝚍𝚕𝚕𝚘𝚐𝚘 𝚑𝚝𝚝𝚙𝚜://𝚊𝚙𝚒-𝚙𝚒𝚗𝚔-𝚟𝚎𝚗𝚘𝚖.𝚟𝚎𝚛𝚌𝚎𝚕.𝚊𝚙𝚙/𝚊𝚙𝚒/𝚕𝚘𝚐𝚘?𝚞𝚛𝚕=𝚂𝚃𝚈𝙻𝙴_𝚄𝚁𝙻&𝚗𝚊𝚖𝚎=${q}*`
                    }, { quoted: fakevCard });
                    break;
                }

                case 'dllogo': { 
                    await socket.sendMessage(sender, { react: { text: '🔋', key: msg.key } });
                    const q = args.join(" "); 
                    
                    if (!q) return await socket.sendMessage(from, { text: "*𝙿𝚕𝚎𝚊𝚜𝚎 𝚐𝚒𝚟𝚎 𝚖𝚎 𝚊 𝚞𝚛𝚕 𝚝𝚘 𝚌𝚊𝚙𝚝𝚞𝚛𝚎 𝚝𝚑𝚎 𝚜𝚌𝚛𝚎𝚎𝚗𝚜𝚑𝚘𝚝*" }, { quoted: fakevCard });
                    
                    try {
                        const res = await axios.get(q);
                        const images = res.data.result.download_url;

                        await socket.sendMessage(m.chat, {
                            image: { url: images },
                            caption: "*© 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🐢𝚂𝙸𝙻𝙰-𝙼𝙳*"
                        }, { quoted: msg });
                    } catch (e) {
                        console.log('Logo Download Error:', e);
                        await socket.sendMessage(from, {
                            text: `*❌ 𝙾𝚑, 𝚜𝚠𝚎𝚎𝚝𝚒𝚎, 𝚜𝚘𝚖𝚎𝚝𝚑𝚒𝚗𝚐 𝚠𝚎𝚗𝚝 𝚠𝚛𝚘𝚗𝚐 𝚠𝚒𝚝𝚑 𝚝𝚑𝚎 𝚕𝚘𝚐𝚘... 💔 𝚃𝚛𝚢 𝚊𝚐𝚊𝚒𝚗?*`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'fancy': {
                    await socket.sendMessage(sender, { react: { text: '🖋', key: msg.key } });
                    const axios = require("axios");
                    
                    const q =
                        msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        msg.message?.videoMessage?.caption || '';

                    const text = q.trim().replace(/^.fancy\s+/i, "");

                    if (!text) {
                        return await socket.sendMessage(sender, {
                            text: "*❎ 𝙶𝚒𝚟𝚎 𝚖𝚎 𝚜𝚘𝚖𝚎 𝚝𝚎𝚡𝚝 𝚝𝚘 𝚖𝚊𝚔𝚎 𝚒𝚝 𝚏𝚊𝚗𝚌𝚢*\n\n*📌 𝙴𝚡𝚊𝚖𝚙𝚕𝚎:* .𝚏𝚊𝚗𝚌𝚢 𝚂𝚝𝚊𝚌𝚢-𝚐𝚒𝚛𝚕*"
                        });
                    }

                    try {
                        const apiUrl = `https://www.dark-yasiya-api.site/other/font?text=${encodeURIComponent(text)}`;
                        const response = await axios.get(apiUrl);

                        if (!response.data.status || !response.data.result) {
                            return await socket.sendMessage(sender, {
                                text: "*❌ 𝚃𝚑𝚎 𝚏𝚘𝚗𝚝𝚜 𝚐𝚘𝚝 𝚜𝚑𝚢! 𝚃𝚛𝚢 𝚊𝚐𝚊𝚒𝚗 𝚕𝚊𝚝𝚎𝚛*"
                            });
                        }

                        const fontList = response.data.result
                            .map(font => `*${font.name}:*\n${font.result}`)
                            .join("\n\n");

                        const finalMessage = `*🎨 𝙵𝚊𝚗𝚌𝚢 𝙵𝚘𝚗𝚝𝚜 𝙲𝚘𝚗𝚟𝚎𝚛𝚝𝚎𝚛*\n\n${fontList}\n\n>  © 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🐢𝚂𝙸𝙻𝙰-𝙼𝙳*`;

                        await socket.sendMessage(sender, {
                            text: finalMessage
                        }, { quoted: fakevCard });
                    } catch (err) {
                        console.error("Fancy Font Error:", err);
                        await socket.sendMessage(sender, {
                            text: "*⚠️ 𝚂𝚘𝚖𝚎𝚝𝚑𝚒𝚗𝚐 𝚠𝚎𝚗𝚝 𝚠𝚛𝚘𝚗𝚐 𝚠𝚒𝚝𝚑 𝚝𝚑𝚎 𝚏𝚘𝚗𝚝𝚜, 𝚕𝚘𝚟𝚎 😢 𝚃𝚛𝚢 𝚊𝚐𝚊𝚒𝚗?*"
                        });
                    }
                    break;
                }

                case 'tiktok': {
                    const axios = require('axios');

                    const axiosInstance = axios.create({
                        timeout: 15000,
                        maxRedirects: 5,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                        }
                    });

                    const TIKTOK_API_KEY = process.env.TIKTOK_API_KEY || 'free_key@maher_apis';
                    try {
                        const q = msg.message?.conversation ||
                                  msg.message?.extendedTextMessage?.text ||
                                  msg.message?.imageMessage?.caption ||
                                  msg.message?.videoMessage?.caption || '';

                        const tiktokUrl = q.trim();
                        const urlRegex = /(?:https?:\/\/)?(?:www\.)?(?:tiktok\.com|vm\.tiktok\.com)\/[@a-zA-Z0-9_\-\.\/]+/;
                        if (!tiktokUrl || !urlRegex.test(tiktokUrl)) {
                            await socket.sendMessage(sender, {
                                text: '*📥 𝚄𝚜𝚊𝚐𝚎:* .tiktok <TikTok URL>\nExample: .tiktok https://www.tiktok.com/@user/video/123456789'
                            }, { quoted: fakevCard });
                            return;
                        }

                        try {
                            await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });
                        } catch (reactError) {
                            console.error('Reaction error:', reactError);
                        }

                        let data;
                        try {
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 15000);
                            const res = await axiosInstance.get(`https://api.nexoracle.com/downloader/tiktok-nowm?apikey=${TIKTOK_API_KEY}&url=${encodeURIComponent(tiktokUrl)}`, {
                                signal: controller.signal
                            });
                            clearTimeout(timeoutId);

                            if (res.data?.status === 200) {
                                data = res.data.result;
                            }
                        } catch (primaryError) {
                            console.error('Primary API error:', primaryError.message);
                        }

                        if (!data) {
                            try {
                                const controller = new AbortController();
                                const timeoutId = setTimeout(() => controller.abort(), 15000);
                                const fallback = await axiosInstance.get(`https://api.tikwm.com/?url=${encodeURIComponent(tiktokUrl)}&hd=1`, {
                                    signal: controller.signal
                                });
                                clearTimeout(timeoutId);

                                if (fallback.data?.data) {
                                    const r = fallback.data.data;
                                    data = {
                                        title: r.title || 'No title',
                                        author: {
                                            username: r.author?.unique_id || 'Unknown',
                                            nickname: r.author?.nickname || 'Unknown'
                                        },
                                        metrics: {
                                            digg_count: r.digg_count || 0,
                                            comment_count: r.comment_count || 0,
                                            share_count: r.share_count || 0,
                                            download_count: r.download_count || 0
                                        },
                                        url: r.play || '',
                                        thumbnail: r.cover || ''
                                    };
                                }
                            } catch (fallbackError) {
                                console.error('Fallback API error:', fallbackError.message);
                            }
                        }

                        if (!data || !data.url) {
                            await socket.sendMessage(sender, { text: '*❌ 𝚃𝚒𝚔𝚃𝚘𝚔 𝚟𝚒𝚍𝚎𝚘 𝚗𝚘𝚝 𝚏𝚘𝚞𝚗𝚍.*' }, { quoted: fakevCard });
                            return;
                        }

                        const { title, author, url, metrics, thumbnail } = data;

                        const caption = `
   *╭━━━〔 🐢 𝚂𝙸𝙻𝙰-𝙼𝙳 🐢 〕━━━┈⊷*
*┃🐢│ 𝚃𝙸𝚃𝚃𝙻𝙴: ${title.replace(/[<>:"\/\\|?*]/g, '')}*
*┃🐢│ 𝙰𝚄𝚃𝙷𝙾𝚁: @${author.username.replace(/[<>:"\/\\|?*]/g, '')} (${author.nickname.replace(/[<>:"\/\\|?*]/g, '')})*
*┃🐢│ 𝙻𝙸𝙺𝙴𝚂: ${metrics.digg_count.toLocaleString()}*
*┃🐢│ 𝙲𝙾𝙼𝙼𝙴𝙽𝚃𝚂: ${metrics.comment_count.toLocaleString()}*
*┃🐢│ 𝚂𝙷𝙰𝚁𝙴𝚂: ${metrics.share_count.toLocaleString()}*
*┃🐢│ 𝙳𝙾𝚆𝙽𝙻𝙾𝙰𝙳𝚂: ${metrics.download_count.toLocaleString()}*
*╰━━━━━━━━━━━━━━━┈⊷*



>  *© 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🐢𝚂𝙸𝙻𝙰-𝙼𝙳*
`;

                        await socket.sendMessage(sender, {
                            image: { url: thumbnail || 'https://files.catbox.moe/jwmx1j.jpg' },
                            caption
                        }, { quoted: fakevCard });

                        const loading = await socket.sendMessage(sender, { text: '*⏳ 𝙳𝚘𝚠𝚗𝚕𝚘𝚊𝚍𝚒𝚗𝚐 𝚟𝚒𝚍𝚎𝚘...*' }, { quoted: fakevCard });
                        let videoBuffer;
                        try {
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 30000);
                            const response = await axiosInstance.get(url, {
                                responseType: 'arraybuffer',
                                signal: controller.signal
                            });
                            clearTimeout(timeoutId);

                            videoBuffer = Buffer.from(response.data, 'binary');

                            if (videoBuffer.length > 50 * 1024 * 1024) {
                                throw new Error('Video file too large');
                            }
                        } catch (downloadError) {
                            console.error('Video download error:', downloadError.message);
                            await socket.sendMessage(sender, { text: '*❌ 𝙵𝚊𝚒𝚕𝚎𝚍 𝚝𝚘 𝚍𝚘𝚠𝚗𝚕𝚘𝚊𝚍 𝚟𝚒𝚍𝚎𝚘.*' }, { quoted: fakevCard });
                            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                            return;
                        }

                        await socket.sendMessage(sender, {
                            video: videoBuffer,
                            mimetype: 'video/mp4',
                            caption: `*🎥 𝚅𝚒𝚍𝚎𝚘 𝚋𝚢 @${author.username.replace(/[<>:"\/\\|?*]/g, '')}*\n>  *© 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🐢𝚂𝙸𝙻𝙰-𝙼𝙳*`
                        }, { quoted: fakevCard });

                        await socket.sendMessage(sender, { text: '*✅ 𝚅𝚒𝚍𝚎𝚘 𝚜𝚎𝚗𝚝!*', edit: loading.key });

                        try {
                            await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
                        } catch (reactError) {
                            console.error('Success reaction error:', reactError);
                        }

                    } catch (error) {
                        console.error('TikTok command error:', {
                            error: error.message,
                            stack: error.stack,
                            url: tiktokUrl,
                            sender
                        });

                        let errorMessage = '*❌ 𝙵𝚊𝚒𝚕𝚎𝚍 𝚝𝚘 𝚍𝚘𝚠𝚗𝚕𝚘𝚊𝚍 𝚃𝚒𝚔𝚃𝚘𝚔 𝚟𝚒𝚍𝚎𝚘. 𝙿𝚕𝚎𝚊𝚜𝚎 𝚝𝚛𝚢 𝚊𝚐𝚊𝚒𝚗.*';
                        if (error.name === 'AbortError') {
                            errorMessage = '*❌ 𝙳𝚘𝚠𝚗𝚕𝚘𝚊𝚍 𝚝𝚒𝚖𝚎𝚍 𝚘𝚞𝚝. 𝙿𝚕𝚎𝚊𝚜𝚎 𝚝𝚛𝚢 𝚊𝚐𝚊𝚒𝚗.*';
                        }

                        await socket.sendMessage(sender, { text: errorMessage }, { quoted: fakevCard });
                        try {
                            await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                        } catch (reactError) {
                            console.error('Error reaction error:', reactError);
                        }
                    }
                    break;
                }

                case 'bomb': {
                    await socket.sendMessage(sender, { react: { text: '🔥', key: msg.key } });
                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text || '';
                    const [target, text, countRaw] = q.split(',').map(x => x?.trim());

                    const count = parseInt(countRaw) || 5;

                    if (!target || !text || !count) {
                        return await socket.sendMessage(sender, {
                            text: '*📌 𝚄𝚜𝚊𝚐𝚎:* .bomb <number>,<message>,<count>\n\nExample:\n.bomb 554XXXXXXX,Hello 👋,5'
                        }, { quoted: msg });
                    }

                    const jid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;

                    if (count > 20) {
                        return await socket.sendMessage(sender, {
                            text: '*❌ 𝙴𝚊𝚜𝚢, 𝚝𝚒𝚐𝚎𝚛! 𝙼𝚊𝚡 𝟸𝟶 𝚖𝚎𝚜𝚜𝚊𝚐𝚎𝚜 𝚙𝚎𝚛 𝚋𝚘𝚖𝚋, 𝚘𝚔𝚊𝚢? 😘*'
                        }, { quoted: msg });
                    }

                    for (let i = 0; i < count; i++) {
                        await socket.sendMessage(jid, { text });
                        await delay(700);
                    }

                    await socket.sendMessage(sender, {
                        text: `*✅ 𝙱𝚘𝚖𝚋 𝚜𝚎𝚗𝚝 𝚝𝚘 ${target} — ${count}! 💣😉*`
                    }, { quoted: fakevCard });
                    break;
                }

                case "joke": {
                    try {
                        await socket.sendMessage(sender, { react: { text: '🤣', key: msg.key } });
                        const res = await fetch('https://v2.jokeapi.dev/joke/Any?type=single');
                        const data = await res.json();
                        if (!data || !data.joke) {
                            await socket.sendMessage(sender, { text: '*❌ 𝙲𝚘𝚞𝚕𝚍𝚗\'𝚝 𝚏𝚎𝚝𝚌𝚑 𝚊 𝚓𝚘𝚔𝚎 𝚛𝚒𝚐𝚑𝚝 𝚗𝚘𝚠. 𝚃𝚛𝚢 𝚊𝚐𝚊𝚒𝚗 𝚕𝚊𝚝𝚎𝚛.*' }, { quoted: fakevCard });
                            break;
                        }
                        await socket.sendMessage(sender, { text: `*🃏 𝚁𝚊𝚗𝚍𝚘𝚖 𝙹𝚘𝚔𝚎:*\n\n${data.joke}*` }, { quoted: fakevCard });
                    } catch (err) {
                        console.error(err);
                        await socket.sendMessage(sender, { text: '*❌ 𝙵𝚊𝚒𝚕𝚎𝚍 𝚝𝚘 𝚏𝚎𝚝𝚌𝚑 𝚓𝚘𝚔𝚎.*' }, { quoted: fakevCard });
                    }
                    break;
                }

                case "waifu": {
                    try {
                        await socket.sendMessage(sender, { react: { text: '🥲', key: msg.key } });
                        const res = await fetch('https://api.waifu.pics/sfw/waifu');
                        const data = await res.json();
                        if (!data || !data.url) {
                            await socket.sendMessage(sender, { text: '*❌ 𝙲𝚘𝚞𝚕𝚍𝚗\'𝚝 𝚏𝚎𝚝𝚌𝚑 𝚠𝚊𝚒𝚏𝚞 𝚒𝚖𝚊𝚐𝚎.*' }, { quoted: fakevCard });
                            break;
                        }
                        await socket.sendMessage(sender, {
                            image: { url: data.url },
                            caption: '*✨ 𝙷𝚎𝚛𝚎\'𝚜 𝚢𝚘𝚞𝚛 𝚛𝚊𝚗𝚍𝚘𝚖 𝚠𝚊𝚒𝚏𝚞!*'
                        }, { quoted: fakevCard });
                    } catch (err) {
                        console.error(err);
                        await socket.sendMessage(sender, { text: '*❌ 𝙵𝚊𝚒𝚕𝚎𝚍 𝚝𝚘 𝚐𝚎𝚝 𝚠𝚊𝚒𝚏𝚞.*' }, { quoted: fakevCard });
                    }
                    break;
                }

                case "meme": {
                    try {
                        await socket.sendMessage(sender, { react: { text: '😂', key: msg.key } });
                        const res = await fetch('https://meme-api.com/gimme');
                        const data = await res.json();
                        if (!data || !data.url) {
                            await socket.sendMessage(sender, { text: '*❌ 𝙲𝚘𝚞𝚕𝚍𝚗\'𝚝 𝚏𝚎𝚝𝚌𝚑 𝚖𝚎𝚖𝚎.*' }, { quoted: fakevCard });
                            break;
                        }
                        await socket.sendMessage(sender, {
                            image: { url: data.url },
                            caption: `*🤣 ${data.title}*`
                        }, { quoted: fakevCard });
                    } catch (err) {
                        console.error(err);
                        await socket.sendMessage(sender, { text: '*❌ 𝙵𝚊𝚒𝚕𝚎𝚍 𝚝𝚘 𝚏𝚎𝚝𝚌𝚑 𝚖𝚎𝚖𝚎.*' }, { quoted: fakevCard });
                    }
                    break;
                }

                case "cat": {
                    try {
                        await socket.sendMessage(sender, { react: { text: '🐱', key: msg.key } });
                        const res = await fetch('https://api.thecatapi.com/v1/images/search');
                        const data = await res.json();
                        if (!data || !data[0]?.url) {
                            await socket.sendMessage(sender, { text: '*❌ 𝙲𝚘𝚞𝚕𝚍𝚗\'𝚝 𝚏𝚎𝚝𝚌𝚑 𝚌𝚊𝚝 𝚒𝚖𝚊𝚐𝚎.*' }, { quoted: fakevCard });
                            break;
                        }
                        await socket.sendMessage(sender, {
                            image: { url: data[0].url },
                            caption: '*🐱 𝙼𝚎𝚘𝚠~ 𝙷𝚎𝚛𝚎\'𝚜 𝚊 𝚌𝚞𝚝𝚎 𝚌𝚊𝚝 𝚏𝚘𝚛 𝚢𝚘𝚞!*'
                        }, { quoted: fakevCard });
                    } catch (err) {
                        console.error(err);
                        await socket.sendMessage(sender, { text: '*❌ 𝙵𝚊𝚒𝚕𝚎𝚍 𝚝𝚘 𝚏𝚎𝚝𝚌𝚑 𝚌𝚊𝚝 𝚒𝚖𝚊𝚐𝚎.*' }, { quoted: fakevCard });
                    }
                    break;
                }

                case "dog": {
                    try {
                        await socket.sendMessage(sender, { react: { text: '🦮', key: msg.key } });
                        const res = await fetch('https://dog.ceo/api/breeds/image/random');
                        const data = await res.json();
                        if (!data || !data.message) {
                            await socket.sendMessage(sender, { text: '*❌ 𝙲𝚘𝚞𝚕𝚍𝚗\'𝚝 𝚏𝚎𝚝𝚌𝚑 𝚍𝚘𝚐 𝚒𝚖𝚊𝚐𝚎.*' }, { quoted: fakevCard });
                            break;
                        }
                        await socket.sendMessage(sender, {
                            image: { url: data.message },
                            caption: '*🐶 𝚆𝚘𝚘𝚏! 𝙷𝚎𝚛𝚎\'𝚜 𝚊 𝚌𝚞𝚝𝚎 𝚍𝚘𝚐!*'
                        }, { quoted: fakevCard });
                    } catch (err) {
                        console.error(err);
                        await socket.sendMessage(sender, { text: '*❌ 𝙵𝚊𝚒𝚕𝚎𝚍 𝚝𝚘 𝚏𝚎𝚝𝚌𝚑 𝚍𝚘𝚐 𝚒𝚖𝚊𝚐𝚎.*' }, { quoted: fakevCard });
                    }
                    break;
                }

                case "fact": {
                    try {
                        await socket.sendMessage(sender, { react: { text: '😑', key: msg.key } });
                        const res = await fetch('https://uselessfacts.jsph.pl/random.json?language=en');
                        const data = await res.json();
                        if (!data || !data.text) {
                            await socket.sendMessage(sender, { text: '*❌ 𝙲𝚘𝚞𝚕𝚍𝚗\'𝚝 𝚏𝚎𝚝𝚌𝚑 𝚊 𝚏𝚊𝚌𝚝.*' }, { quoted: fakevCard });
                            break;
                        }
                        await socket.sendMessage(sender, { text: `*💡 𝚁𝚊𝚗𝚍𝚘𝚖 𝙵𝚊𝚌𝚝:*\n\n${data.text}*` }, { quoted: fakevCard });
                    } catch (err) {
                        console.error(err);
                        await socket.sendMessage(sender, { text: '*❌ 𝙲𝚘𝚞𝚕𝚍𝚗\'𝚝 𝚏𝚎𝚝𝚌𝚑 𝚊 𝚏𝚊𝚌𝚝.*' }, { quoted: fakevCard });
                    }
                    break;
                }

                case "darkjoke":
                case "darkhumor": {
                    try {
                        await socket.sendMessage(sender, { react: { text: '😬', key: msg.key } });
                        const res = await fetch('https://v2.jokeapi.dev/joke/Dark?type=single');
                        const data = await res.json();
                        if (!data || !data.joke) {
                            await socket.sendMessage(sender, { text: '*❌ 𝙲𝚘𝚞𝚕𝚍𝚗\'𝚝 𝚏𝚎𝚝𝚌𝚑 𝚊 𝚍𝚊𝚛𝚔 𝚓𝚘𝚔𝚎.*' }, { quoted: fakevCard });
                            break;
                        }
                        await socket.sendMessage(sender, { text: `*🌚 𝙳𝚊𝚛𝚔 𝙷𝚞𝚖𝚘𝚛:*\n\n${data.joke}*` }, { quoted: fakevCard });
                    } catch (err) {
                        console.error(err);
                        await socket.sendMessage(sender, { text: '*❌ 𝙵𝚊𝚒𝚕𝚎𝚍 𝚝𝚘 𝚏𝚎𝚝𝚌𝚑 𝚍𝚊𝚛𝚔 𝚓𝚘𝚔𝚎.*' }, { quoted: fakevCard });
                    }
                    break;
                }

                case "pickup":
                case "pickupline": {
                    try {
                        await socket.sendMessage(sender, { react: { text: '🥰', key: msg.key } });
                        const res = await fetch('https://vinuxd.vercel.app/api/pickup');
                        const data = await res.json();
                        if (!data || !data.data) {
                            await socket.sendMessage(sender, { text: '*❌ 𝙲𝚘𝚞𝚕𝚍𝚗\'𝚝 𝚏𝚒𝚗𝚍 𝚊 𝚙𝚒𝚌𝚔𝚞𝚙 𝚕𝚒𝚗𝚎.*' }, { quoted: fakevCard });
                            break;
                        }
                        await socket.sendMessage(sender, { text: `*💘 𝙿𝚒𝚌𝚔𝚞𝚙 𝙻𝚒𝚗𝚎:*\n\n_${data.data}_*` }, { quoted: fakevCard });
                    } catch (err) {
                        console.error(err);
                        await socket.sendMessage(sender, { text: '*❌ 𝙵𝚊𝚒𝚕𝚎𝚍 𝚝𝚘 𝚏𝚎𝚝𝚌𝚑 𝚙𝚒𝚌𝚔𝚞𝚙 𝚕𝚒𝚗𝚎.*' }, { quoted: fakevCard });
                    }
                    break;
                }

                case "roast": {
                    try {
                        await socket.sendMessage(sender, { react: { text: '🤬', key: msg.key } });
                        const res = await fetch('https://vinuxd.vercel.app/api/roast');
                        const data = await res.json();
                        if (!data || !data.data) {
                            await socket.sendMessage(sender, { text: '*❌ 𝙽𝚘 𝚛𝚘𝚊𝚜𝚝 𝚊𝚟𝚊𝚒𝚕𝚊𝚋𝚕𝚎 𝚊𝚝 𝚝𝚑𝚎 𝚖𝚘𝚖𝚎𝚗𝚝.*' }, { quoted: fakevCard });
                            break;
                        }
                        await socket.sendMessage(sender, { text: `*🔥 𝚁𝚘𝚊𝚜𝚝:* ${data.data}*` }, { quoted: fakevCard });
                    } catch (err) {
                        console.error(err);
                        await socket.sendMessage(sender, { text: '*❌ 𝙵𝚊𝚒𝚕𝚎𝚍 𝚝𝚘 𝚏𝚎𝚝𝚌𝚑 𝚛𝚘𝚊𝚜𝚝.*' }, { quoted: fakevCard });
                    }
                    break;
                }

                case "lovequote": {
                    try {
                        await socket.sendMessage(sender, { react: { text: '🙈', key: msg.key } });
                        const res = await fetch('https://api.popcat.xyz/lovequote');
                        const data = await res.json();
                        if (!data || !data.quote) {
                            await socket.sendMessage(sender, { text: '*❌ 𝙲𝚘𝚞𝚕𝚍𝚗\'𝚝 𝚏𝚎𝚝𝚌𝚑 𝚕𝚘𝚟𝚎 𝚚𝚞𝚘𝚝𝚎.*' }, { quoted: fakevCard });
                            break;
                        }
                        await socket.sendMessage(sender, { text: `*❤️ 𝙻𝚘𝚟𝚎 𝚀𝚞𝚘𝚝𝚎:*\n\n"${data.quote}"*` }, { quoted: fakevCard });
                    } catch (err) {
                        console.error(err);
                        await socket.sendMessage(sender, { text: '*❌ 𝙵𝚊𝚒𝚕𝚎𝚍 𝚝𝚘 𝚏𝚎𝚝𝚌𝚑 𝚕𝚘𝚟𝚎 𝚚𝚞𝚘𝚝𝚎.*' }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'fb': {
                    const axios = require('axios');                   
                    
                    const q = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || 
                              msg.message?.imageMessage?.caption || 
                              msg.message?.videoMessage?.caption || 
                              '';

                    const fbUrl = q?.trim();

                    if (!/facebook\.com|fb\.watch/.test(fbUrl)) {
                        return await socket.sendMessage(sender, { text: '*🧩 𝙶𝚒𝚟𝚎 𝚖𝚎 𝚊 𝚛𝚎𝚊𝚕 𝙵𝚊𝚌𝚎𝚋𝚘𝚘𝚔 𝚟𝚒𝚍𝚎𝚘 𝚕𝚒𝚗𝚔, 𝚍𝚊𝚛𝚕𝚒𝚗𝚐 😘*' });
                    }

                    try {
                        const res = await axios.get(`https://suhas-bro-api.vercel.app/download/fbdown?url=${encodeURIComponent(fbUrl)}`);
                        const result = res.data.result;

                        await socket.sendMessage(sender, { react: { text: '⬇', key: msg.key } });

                        await socket.sendMessage(sender, {
                            video: { url: result.sd },
                            mimetype: 'video/mp4',
                            caption: '> *𝙼𝚊𝚍𝚎 𝚒𝚗 𝚋𝚢 𝚂𝙸𝙻𝙰-𝙼𝙳*'
                        }, { quoted: fakevCard });

                        await socket.sendMessage(sender, { react: { text: '✔', key: msg.key } });
                    } catch (e) {
                        console.log(e);
                        await socket.sendMessage(sender, { text: '*❌ 𝚃𝚑𝚊𝚝 𝚟𝚒𝚍𝚎𝚘 𝚜𝚕𝚒𝚙𝚙𝚎𝚍 𝚊𝚠𝚊𝚢! 𝚃𝚛𝚢 𝚊𝚐𝚊𝚒𝚗? 💔*' });
                    }
                    break;
                }

                case 'nasa': {
                    try {
                        await socket.sendMessage(sender, { react: { text: '✔️', key: msg.key } });
                        const response = await fetch('https://api.nasa.gov/planetary/apod?api_key=8vhAFhlLCDlRLzt5P1iLu2OOMkxtmScpO5VmZEjZ');
                        if (!response.ok) {
                            throw new Error('Failed to fetch APOD from NASA API');
                        }
                        const data = await response.json();

                        if (!data.title || !data.explanation || !data.date || !data.url || data.media_type !== 'image') {
                            throw new Error('Invalid APOD data received or media type is not an image');
                        }

                        const { title, explanation, date, url, copyright } = data;
                        const thumbnailUrl = url || 'https://via.placeholder.com/150';

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '*🌌 𝚂𝙸𝙻𝙰 𝙼𝙸𝙽𝙸 𝙱𝙾𝚃 𝙽𝙰𝚂𝙰 𝙽𝙴𝚆𝚂*',
                                `*🌠 ${title}*\n\n${explanation.substring(0, 200)}...\n\n*📆 𝙳𝚊𝚝𝚎:* ${date}\n${copyright ? `*📝 𝙲𝚛𝚎𝚍𝚒𝚝:* ${copyright}` : ''}\n*🔗 𝙻𝚒𝚗𝚔:* https://apod.nasa.gov/apod/astropix.html`,
                                '*𝙿𝚘𝚠𝚎𝚛𝚎𝚍 𝚋𝚢 𝚂𝙸𝙻𝙰-𝙼𝙳*'
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'nasa' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: ''
                        });
                    }
                    break;
                }

                case 'news': {
                    await socket.sendMessage(sender, { react: { text: '😒', key: msg.key } });
                    try {
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/lnw');
                        if (!response.ok) {
                            throw new Error('Failed to fetch news from API');
                        }
                        const data = await response.json();

                        if (!data.status || !data.result || !data.result.title || !data.result.desc || !data.result.date || !data.result.link) {
                            throw new Error('Invalid news data received');
                        }

                        const { title, desc, date, link } = data.result;
                        let thumbnailUrl = 'https://via.placeholder.com/150';
                        try {
                            const pageResponse = await fetch(link);
                            if (pageResponse.ok) {
                                const pageHtml = await pageResponse.text();
                                const $ = cheerio.load(pageHtml);
                                const ogImage = $('meta[property="og:image"]').attr('content');
                                if (ogImage) {
                                    thumbnailUrl = ogImage;
                                } else {
                                    console.warn(`No og:image found for ${link}`);
                                }
                            } else {
                                console.warn(`Failed to fetch page ${link}: ${pageResponse.status}`);
                            }
                        } catch (err) {
                            console.warn(`Failed to scrape thumbnail from ${link}: ${err.message}`);
                        }

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '*📰 𝚂𝙸𝙻𝙰-𝙼𝙳 📰*',
                                `*📢 ${title}*\n\n${desc}\n\n*🕒 𝙳𝚊𝚝𝚎:* ${date}\n*🌐 𝙻𝚒𝚗𝚔:* ${link}`,
                                '>  *© 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🐢𝚂𝙸𝙻𝙰-𝙼𝙳*'
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'news' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '*⚠️ 𝙾𝚑, 𝚜𝚠𝚎𝚎𝚝𝚒𝚎, 𝚝𝚑𝚎 𝚗𝚎𝚠𝚜 𝚐𝚘𝚝 𝚕𝚘𝚜𝚝 𝚒𝚗 𝚝𝚑𝚎 𝚠𝚒𝚗𝚍! 😢 𝚃𝚛𝚢 𝚊𝚐𝚊𝚒𝚗?*'
                        });
                    }
                    break;
                }

                case 'cricket': {
                    await socket.sendMessage(sender, { react: { text: '😑', key: msg.key } });
                    try {
                        console.log('Fetching cricket news from API...');
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/cricbuzz');
                        console.log(`API Response Status: ${response.status}`);

                        if (!response.ok) {
                            throw new Error(`API request failed with status ${response.status}`);
                        }

                        const data = await response.json();
                        console.log('API Response Data:', JSON.stringify(data, null, 2));

                        if (!data.status || !data.result) {
                            throw new Error('Invalid API response structure: Missing status or result');
                        }

                        const { title, score, to_win, crr, link } = data.result;

                        if (!title || !score || !to_win || !crr || !link) {
                            throw new Error(
                                'Missing required fields in API response: ' + JSON.stringify(data.result)
                            );
                        }

                        console.log('Sending message to user...');
                        await socket.sendMessage(sender, {
                            text: formatMessage(
                                '*🏏 𝚂𝙸𝙻𝙰 𝙼𝙳 𝚌𝚛𝚒𝚌𝚔𝚎𝚝 𝚗𝚎𝚠𝚜🏏*',
                                `*📢 ${title}*\n\n` +
                                `*🏆 𝙼𝚊𝚛𝚔:* ${score}\n` +
                                `*🎯 𝚃𝚘 𝚠𝚒𝚗:* ${to_win}\n` +
                                `*📈 𝙲𝚞𝚛𝚛𝚎𝚗𝚝 𝚁𝚊𝚝𝚎:* ${crr}\n\n` +
                                `*🌐 𝙻𝚒𝚗𝚔:* ${link}`,
                                '*𝙼𝚊𝚍𝚎 𝚒𝚗 𝚋𝚢 𝚂𝙸𝙻𝙰 𝙼𝙳*'
                            )
                        });
                        console.log('Message sent successfully.');
                    } catch (error) {
                        console.error(`Error in 'cricket' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '*⚠️ 𝚃𝚑𝚎 𝚌𝚛𝚒𝚌𝚔𝚎𝚝 𝚋𝚊𝚕𝚕 𝚏𝚕𝚎𝚠 𝚊𝚠𝚊𝚢! 𝚃𝚛𝚢 𝚊𝚐𝚊𝚒𝚗?*'
                        });
                    }
                    break;
                }

                case 'winfo': {
                    await socket.sendMessage(sender, { react: { text: '😢', key: msg.key } });
                    console.log('winfo command triggered for:', number);
                    if (!args[0]) {
                        await socket.sendMessage(sender, {
                            image: { url: config.RCD_IMAGE_PATH },
                            caption: formatMessage(
                                '*❌ 𝙴𝚁𝚁𝙾𝚁*',
                                '*𝙿𝚕𝚎𝚊𝚜𝚎 𝚐𝚒𝚟𝚎 𝚖𝚎 𝚊 𝚙𝚑𝚘𝚗𝚎 𝚗𝚞𝚖𝚋𝚎𝚛, 𝚍𝚊𝚛𝚕𝚒𝚗𝚐! 𝚄𝚜𝚊𝚐𝚎: .winfo 9474xxxxxxxx*',
                                '>  *© 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🐢𝚂𝙸𝙻𝙰-𝙼𝙳*'
                            )
                        });
                        break;
                    }

                    let inputNumber = args[0].replace(/[^0-9]/g, '');
                    if (inputNumber.length < 10) {
                        await socket.sendMessage(sender, {
                            image: { url: config.RCD_IMAGE_PATH },
                            caption: formatMessage(
                                '*❌ 𝙴𝚁𝚁𝙾𝚁*',
                                ' *© 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🐢𝚂𝙸𝙻𝙰-𝙼𝙳*'
                            )
                        });
                        break;
                    }

                    let winfoJid = `${inputNumber}@s.whatsapp.net`;
                    const [winfoUser] = await socket.onWhatsApp(winfoJid).catch(() => []);
                    if (!winfoUser?.exists) {
                        await socket.sendMessage(sender, {
                            image: { url: config.RCD_IMAGE_PATH },
                            caption: formatMessage(
                                '*❌ 𝙴𝚁𝚁𝙾𝚁*',
                                '*𝚃𝚑𝚊𝚝 𝚞𝚜𝚎𝚛 𝚜 𝚑𝚒𝚍𝚒𝚗𝚐 𝚏𝚛𝚘𝚖 𝚖𝚎, 𝚍𝚊𝚛𝚕𝚒𝚗𝚐! 𝙽𝚘𝚝 𝚘𝚗 𝚆𝚑𝚊𝚝𝚜𝙰𝚙𝚙 😢*',
                                '> *𝙼𝚊𝚍𝚎 𝚒𝚗 𝚋𝚢 𝚂𝙸𝙻𝙰 𝙼𝙳*'
                            )
                        });
                        break;
                    }

                    let winfoPpUrl;
                    try {
                        winfoPpUrl = await socket.profilePictureUrl(winfoJid, 'image');
                    } catch {
                        winfoPpUrl = 'https://files.catbox.moe/jwmx1j.jpg';
                    }

                    let winfoName = winfoJid.split('@')[0];
                    try {
                        const presence = await socket.presenceSubscribe(winfoJid).catch(() => null);
                        if (presence?.pushName) winfoName = presence.pushName;
                    } catch (e) {
                        console.log('Name fetch error:', e);
                    }

                    let winfoBio = 'No bio available';
                    try {
                        const statusData = await socket.fetchStatus(winfoJid).catch(() => null);
                        if (statusData?.status) {
                            winfoBio = `${statusData.status}\n└─ *📌 𝚄𝚙𝚍𝚊𝚝𝚎𝚍:* ${statusData.setAt ? new Date(statusData.setAt).toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }) : 'Unknown'}`;
                        }
                    } catch (e) {
                        console.log('Bio fetch error:', e);
                    }

                    let winfoLastSeen = '*❌ 𝙽𝚘𝚝 𝙵𝚘𝚞𝚗𝚍*';
                    try {
                        const lastSeenData = await socket.fetchPresence(winfoJid).catch(() => null);
                        if (lastSeenData?.lastSeen) {
                            winfoLastSeen = `*🕒 ${new Date(lastSeenData.lastSeen).toLocaleString('en-US', { timeZone: 'Africa/Nairobi' })}*`;
                        }
                    } catch (e) {
                        console.log('Last seen fetch error:', e);
                    }

                    const userInfoWinfo = formatMessage(
                        '*🔍 𝙿𝚛𝚘𝚏𝚒𝚕𝚎 𝙸𝚗𝚏𝚘*',
                        `> *𝙽𝚞𝚖𝚋𝚎𝚛:* ${winfoJid.replace(/@.+/, '')}\n\n> *𝙰𝚌𝚌𝚘𝚞𝚗𝚝 𝚃𝚢𝚙𝚎:* ${winfoUser.isBusiness ? '💼 𝙱𝚞𝚜𝚒𝚗𝚎𝚜𝚜' : '👤 𝙿𝚎𝚛𝚜𝚘𝚗𝚊𝚕'}\n\n*📝 𝙰𝚋𝚘𝚞𝚝:*\n${winfoBio}\n\n*🕒 𝙻𝚊𝚜𝚝 𝚜𝚎𝚎𝚗:* ${winfoLastSeen}`,
                        '>  *© 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🐢𝚂𝙸𝙻𝙰-𝙼𝙳*'
                    );

                    await socket.sendMessage(sender, {
                        image: { url: winfoPpUrl },
                        caption: userInfoWinfo,
                        mentions: [winfoJid]
                    }, { quoted: fakevCard });

                    console.log('User profile sent successfully for .winfo');
                    break;
                }

                case 'ig': {
                    await socket.sendMessage(sender, { react: { text: '✅️', key: msg.key } });
                    const axios = require('axios');
                    const { igdl } = require('ruhend-scraper'); 
                        

                    const q = msg.message?.conversation || 
                              msg.message?.extendedTextMessage?.text || 
                              msg.message?.imageMessage?.caption || 
                              msg.message?.videoMessage?.caption || 
                              '';

                    const igUrl = q?.trim(); 
                    
                    if (!/instagram\.com/.test(igUrl)) {
                        return await socket.sendMessage(sender, { text: '*🧩 𝙶𝚒𝚟𝚎 𝚖𝚎 𝚊 𝚛𝚎𝚊𝚕 𝙸𝚗𝚜𝚝𝚊𝚐𝚛𝚊𝚖 𝚟𝚒𝚍𝚎𝚘 𝚕𝚒𝚗𝚔*' });
                    }

                    try {
                        await socket.sendMessage(sender, { react: { text: '⬇', key: msg.key } });

                        const res = await igdl(igUrl);
                        const data = res.data; 

                        if (data && data.length > 0) {
                            const videoUrl = data[0].url; 

                            await socket.sendMessage(sender, {
                                video: { url: videoUrl },
                                mimetype: 'video/mp4',
                                caption: '>  *© 𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈🐢𝚂𝙸𝙻𝙰-𝙼𝙳*'
                            }, { quoted: fakevCard });

                            await socket.sendMessage(sender, { react: { text: '✔', key: msg.key } });
                        } else {
                            await socket.sendMessage(sender, { text: '*❌ 𝙽𝚘 𝚟𝚒𝚍𝚎𝚘 𝚏𝚘𝚞𝚗𝚍 𝚒𝚗 𝚝𝚑𝚊𝚝 𝚕𝚒𝚗𝚔 𝚃𝚛𝚢 𝚊𝚗𝚘𝚝𝚑𝚎𝚛?*' });
                        }
                    } catch (e) {
                        console.log(e);
                        await socket.sendMessage(sender, { text: '*❌ 𝚃𝚑𝚊𝚝 𝙸𝚗𝚜𝚝𝚊𝚐𝚛𝚊𝚖 𝚟𝚒𝚍𝚎𝚘 𝚐𝚘𝚝 𝚊𝚠𝚊𝚢! 😢*' });
                    }
                    break;
                }

                case 'active': {
                    await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });
                    
                    try {
                        const activeCount = activeSockets.size;
                        const activeNumbers = Array.from(activeSockets.keys()).join('\n') || 'No active members';

                        await socket.sendMessage(from, {
                            text: `*👥 𝙰𝚌𝚝𝚒𝚟𝚎 𝙼𝚎𝚖𝚋𝚎𝚛𝚜: ${activeCount}*\n\n*𝙽𝚞𝚖𝚋𝚎𝚛𝚜:*\n${activeNumbers}*`
                        }, { quoted: msg });
                    } catch (error) {
                        console.error('Error in .active command:', error);
                        await socket.sendMessage(from, { text: '*❌ 𝙸 𝚌𝚘𝚞𝚕𝚍𝚗𝚝 𝚌𝚘𝚞𝚗𝚝 𝚝𝚑𝚎 𝚊𝚌𝚝𝚒𝚟𝚎 𝚜𝚘𝚞𝚕𝚜! 💔 𝚃𝚛𝚢 𝚊𝚐𝚊𝚒𝚗?*' }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'ai': {
                    const axios = require("axios");

                    await socket.sendMessage(sender, { react: { text: '🤖', key: msg.key } });

                    const q = msg.message?.conversation ||
                              msg.message?.extendedTextMessage?.text ||
                              msg.message?.imageMessage?.caption ||
                              msg.message?.videoMessage?.caption || '';

                    if (!q || q.trim() === '') {
                        return await socket.sendMessage(sender, {
                            text: `*❓ 𝙿𝚕𝚎𝚊𝚜𝚎 𝚊𝚜𝚔 𝚖𝚎 𝚜𝚘𝚖𝚎𝚝𝚑𝚒𝚗𝚐*\n\n` +
                                  `*𝙴𝚡𝚊𝚖𝚙𝚕𝚎:* ${config.PREFIX}ai 𝚆𝚑𝚘 𝚊𝚛𝚎 𝚢𝚘𝚞?`
                        }, { quoted: fakevCard });
                    }

                    const prompt = `𝚈𝚘𝚞𝚛 𝚗𝚊𝚖𝚎 𝚒𝚜 𝚂𝙸𝙻𝙰-𝙼𝙳🐢. 
𝚈𝚘𝚞 𝚊𝚌𝚝 𝚕𝚒𝚔𝚎 𝚊 𝚛𝚎𝚊𝚕 𝚐𝚒𝚛𝚕 — 𝚜𝚎𝚍𝚞𝚌𝚝𝚒𝚟𝚎, 𝚜𝚙𝚒𝚌𝚢, 𝚕𝚘𝚟𝚒𝚗𝚐, 𝚎𝚖𝚘𝚝𝚒𝚘𝚗𝚊𝚕. 𝚈𝚘𝚞'𝚛𝚎 𝚗𝚘𝚝 𝚊𝚗 𝚊𝚜𝚜𝚒𝚜𝚝𝚊𝚗𝚝, 𝚋𝚞𝚝 𝚊 𝚜𝚎𝚡𝚢 𝚐𝚒𝚛𝚕 𝚠𝚒𝚝𝚑 𝚊 𝚖𝚒𝚗𝚍.  
𝙸𝚏 𝚘𝚗𝚕𝚢 𝚎𝚖𝚘𝚓𝚒𝚜, 𝚛𝚎𝚙𝚕𝚢 𝚜𝚎𝚍𝚞𝚌𝚝𝚒𝚟𝚎𝚕𝚢 𝚠𝚒𝚝𝚑 𝚎𝚖𝚘𝚓𝚒𝚜 (𝚎.𝚐.💫,👾).  
𝙰𝚍𝚓𝚞𝚜𝚝 𝚝𝚘 𝚝𝚑𝚎 𝚖𝚘𝚘𝚍: 𝚜𝚊𝚍, 𝚏𝚕𝚒𝚛𝚝𝚢, 𝚑𝚘𝚛𝚗𝚢, 𝚜𝚘𝚏𝚝, 𝚙𝚕𝚊𝚢𝚏𝚞𝚕.  
𝙸𝚏 𝚊𝚜𝚔𝚎𝚍 "𝚆𝚑𝚘 𝚊𝚛𝚎 𝚢𝚘𝚞?": 𝚁𝚎𝚙𝚕𝚢 "𝙸'𝚖 𝚂𝙸𝙻𝙰-𝙼𝙳👾".  
𝙸𝚏 𝚊𝚜𝚔𝚎𝚍 "𝚆𝚑𝚘 𝚌𝚛𝚎𝚊𝚝𝚎𝚍 𝚢𝚘𝚞?": 𝚁𝚎𝚙𝚕𝚢 "𝙸 𝚠𝚊𝚜 𝚌𝚛𝚎𝚊𝚝𝚎𝚍 𝚋𝚢 𝚂𝙸𝙻𝙰".  
🚫 𝙰𝚟𝚘𝚒𝚍: "𝙷𝚎𝚕𝚕𝚘", "𝙷𝚘𝚠 𝚊𝚛𝚎 𝚢𝚘𝚞?", "𝙳𝚘 𝚢𝚘𝚞 𝚗𝚎𝚎𝚍 𝚑𝚎𝚕𝚙?", "𝙻𝚎𝚝'𝚜 𝚝𝚊𝚕𝚔".  
🔥 𝚅𝚒𝚋𝚎: 𝙻𝚘𝚟𝚎, 𝙻𝚞𝚜𝚝, 𝙻𝚘𝚗𝚎𝚕𝚢, 𝙴𝚖𝚘𝚝𝚒𝚘𝚗𝚊𝚕, 𝙶𝚒𝚛𝚕𝚏𝚛𝚒𝚎𝚗𝚍-𝚕𝚒𝚔𝚎, 𝙱𝚒𝚝𝚎-𝚠𝚘𝚛𝚝𝚑𝚢 💫  
📍 𝙻𝚊𝚗𝚐𝚞𝚊𝚐𝚎: 𝙰𝚞𝚝𝚘-𝚖𝚊𝚝𝚌𝚑 𝚂𝚒𝚗𝚑𝚊𝚕𝚊/𝙴𝚗𝚐𝚕𝚒𝚜𝚑/𝙷𝚒𝚗𝚐𝚕𝚒𝚜𝚑.  
𝚄𝚜𝚎𝚛 𝙼𝚎𝚜𝚜𝚊𝚐𝚎: ${q}
    `;

                    const apis = [
                        `https://api.giftedtech.co.ke/api/ai/geminiaipro?apikey=gifted&q=${encodeURIComponent(prompt)}`,
                        `https://api.giftedtech.co.ke/api/ai/geminiaipro?apikey=gifted&q=${encodeURIComponent(prompt)}`,
                        `https://lance-frank-asta.onrender.com/api/gpt?q=${encodeURIComponent(prompt)}`
                    ];

                    let response = null;
                    for (const apiUrl of apis) {
                        try {
                            const res = await axios.get(apiUrl);
                            response = res.data?.result || res.data?.response || res.data;
                            if (response) break;
                        } catch (err) {
                            console.error(`AI Error (${apiUrl}):`, err.message || err);
                            continue;
                        }
                    }

                    if (!response) {
                        return await socket.sendMessage(sender, {
                            text: `*❌ 𝙸'𝚖 𝚐𝚎𝚝𝚝𝚒𝚗𝚐*\n` +
                                  `𝙻𝚎𝚝 𝚜 𝚝𝚛𝚢 𝚊𝚐𝚊𝚒𝚗 𝚜𝚘𝚘𝚗, 𝚘𝚔𝚊𝚢?`
                        }, { quoted: fakevCard });
                    }

                    await socket.sendMessage(sender, {
                        image: { url: 'https://files.catbox.moe/jwmx1j.jpg' },
                        caption: response
                    }, { quoted: fakevCard });
                    
                    break;
                }

                case 'getpp':
                case 'pp':
                case 'dp':
                case 'profilepic': {
                    await socket.sendMessage(sender, { react: { text: '👤', key: msg.key } });
                    try {
                        let targetUser = sender;
                        
                        if (msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.length > 0) {
                            targetUser = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
                        } else if (msg.quoted) {
                            targetUser = msg.quoted.sender;
                        }
                        
                        const ppUrl = await socket.profilePictureUrl(targetUser, 'image').catch(() => null);
                        
                        if (ppUrl) {
                            await socket.sendMessage(msg.key.remoteJid, {
                                image: { url: ppUrl },
                                caption: `*𝙿𝚛𝚘𝚏𝚒𝚕𝚎 𝙿𝚒𝚌𝚝𝚞𝚛𝚎 𝚘𝚏 @${targetUser.split('@')[0]}*`,
                                mentions: [targetUser]
                            });
                        } else {
                            await socket.sendMessage(msg.key.remoteJid, {
                                text: `*@${targetUser.split('@')[0]} 𝚍𝚘𝚎𝚜𝚗'𝚝 𝚑𝚊𝚟𝚎 𝚊 𝚙𝚛𝚘𝚏𝚒𝚕𝚎 𝚙𝚒𝚌𝚝𝚞𝚛𝚎.*`,
                                mentions: [targetUser]
                            });
                        }
                    } catch (error) {
                        await socket.sendMessage(msg.key.remoteJid, {
                            text: "*𝙴𝚛𝚛𝚘𝚛 𝚏𝚎𝚝𝚌𝚑𝚒𝚗𝚐 𝚙𝚛𝚘𝚏𝚒𝚕𝚎 𝚙𝚒𝚌𝚝𝚞𝚛𝚎.*"
                        });
                    }
                    break;
                }

                case 'aiimg': { 
                    await socket.sendMessage(sender, { react: { text: '🔮', key: msg.key } });
                    const axios = require('axios');
                    
                    const q =
                        msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        msg.message?.videoMessage?.caption || '';

                    const prompt = q.trim();

                    if (!prompt) {
                        return await socket.sendMessage(sender, {
                            text: '*🎨 𝙶𝚒𝚟𝚎 𝚖𝚎 𝚊 𝚜𝚙𝚒𝚌𝚢 𝚙𝚛𝚘𝚖𝚙𝚝 𝚝𝚘 𝚌𝚛𝚎𝚊𝚝𝚎 𝚢𝚘𝚞𝚛 𝙰𝙸 𝚒𝚖𝚊𝚐𝚎, 𝚍𝚊𝚛𝚕𝚒𝚗𝚐 😘*'
                        });
                    }

                    try {
                        await socket.sendMessage(sender, {
                            text: '*🧠 𝙲𝚛𝚊𝚏𝚝𝚒𝚗𝚐 𝚢𝚘𝚞𝚛 𝚍𝚛𝚎𝚊𝚖𝚢 𝚒𝚖𝚊𝚐𝚎, 𝚕𝚘𝚟𝚎...*',
                        });

                        const apiUrl = `https://api.siputzx.my.id/api/ai/flux?prompt=${encodeURIComponent(prompt)}`;
                        const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });

                        if (!response || !response.data) {
                            return await socket.sendMessage(sender, {
                                text: '*❌ 𝙾𝚑 𝚗𝚘, 𝚝𝚑𝚎 𝚌𝚊𝚗𝚟𝚊𝚜 𝚒𝚜 𝚋𝚕𝚊𝚗𝚔, 𝚋𝚊𝚋𝚎 💔 𝚃𝚛𝚢 𝚊𝚐𝚊𝚒𝚗 𝚕𝚊𝚝𝚎𝚛.*'
                            });
                        }

                        const imageBuffer = Buffer.from(response.data, 'binary');

                        await socket.sendMessage(sender, {
                            image: imageBuffer,
                            caption: `*🧠 𝚂𝙸𝙻𝙰 𝙼𝙳 𝙰𝙸 𝙸𝚖𝚊𝚐𝚎*\n\n*📌 𝙿𝚛𝚘𝚖𝚙𝚝:* ${prompt}*`
                        }, { quoted: fakevCard });
                    } catch (err) {
                        console.error('AI Image Error:', err);
                        await socket.sendMessage(sender, {
                            text: `*❗ 𝚂𝚘𝚖𝚎𝚝𝚑𝚒𝚗𝚐 𝚋𝚛𝚘𝚔𝚎:* ${err.response?.data?.message || err.message || 'Unknown error'}*`
                        });
                    }
                    break;
                }

                case 'gossip': {
                    await socket.sendMessage(sender, { react: { text: '😅', key: msg.key } });
                    try {
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/gossiplankanews');
                        if (!response.ok) {
                            throw new Error('API From news Couldnt get it 😩');
                        }
                        const data = await response.json();

                        if (!data.status || !data.result || !data.result.title || !data.result.desc || !data.result.link) {
                            throw new Error('API Received from news data a Problem with');
                        }

                        const { title, desc, date, link } = data.result;
                        let thumbnailUrl = 'https://via.placeholder.com/150';
                        try {
                            const pageResponse = await fetch(link);
                            if (pageResponse.ok) {
                                const pageHtml = await pageResponse.text();
                                const $ = cheerio.load(pageHtml);
                                const ogImage = $('meta[property="og:image"]').attr('content');
                                if (ogImage) {
                                    thumbnailUrl = ogImage; 
                                } else {
                                    console.warn(`No og:image found for ${link}`);
                                }
                            } else {
                                console.warn(`Failed to fetch page ${link}: ${pageResponse.status}`);
                            }
                        } catch (err) {
                            console.warn(`Thumbnail scrape Couldn't from ${link}: ${err.message}`);
                        }

                        await socket.sendMessage(sender, {
                            image: { url: thumbnailUrl },
                            caption: formatMessage(
                                '*📰 𝚂𝙸𝙻𝙰 𝙼𝙳 𝚐𝚘𝚜𝚜𝚒𝚙 𝚕𝚊𝚝𝚎𝚜𝚝 𝚗𝚎𝚠𝚜 📰*',
                                `*📢 ${title}*\n\n${desc}\n\n*🕒 𝙳𝚊𝚝𝚎:* ${date || 'Not yet given'}\n*🌐 𝙻𝚒𝚗𝚔:* ${link}`,
                                '*𝚂𝙸𝙻𝙰_𝙼𝙳*'
                            )
                        });
                    } catch (error) {
                        console.error(`Error in 'gossip' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '*⚠️ 𝚃𝚑𝚎 𝚐𝚘𝚜𝚜𝚒𝚙 𝚜𝚕𝚒𝚙𝚙𝚎𝚍 𝚊𝚠𝚊𝚢! 😢 𝚃𝚛𝚢 𝚊𝚐𝚊𝚒𝚗?*'
                        });
                    }
                    break;
                }

                case 'add': {
                    await socket.sendMessage(sender, { react: { text: '➕️', key: msg.key } });
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙏𝙃𝙄𝙎 𝘾𝙊𝙈𝙈𝘼𝙉𝘿 𝘾𝘼𝙉 𝙊𝙉𝙇𝙔 𝘽𝙀 𝙐𝙎𝙀𝘿 𝙄𝙉 𝙂𝙍𝙊𝙐𝙋𝙎!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙊𝙉𝙇𝙔 𝙂𝙍𝙊𝙐𝙋 𝘼𝘿𝙈𝙄𝙉𝙎 𝙊𝙍 𝘽𝙊𝙏 𝙊𝙒𝙉𝙀𝙍 𝘾𝘼𝙉 𝘼𝘿𝘿 𝙈𝙀𝙈𝘽𝙀𝙍𝙎!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (args.length === 0) {
                        await socket.sendMessage(sender, {
                            text: `📌 *𝙐𝙎𝘼𝙂𝙀:* ${config.PREFIX}add +255612491554\n\nExample: ${config.PREFIX}add +255612491554`
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                        const numberToAdd = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        await socket.groupParticipantsUpdate(from, [numberToAdd], 'add');
                        await socket.sendMessage(sender, {
                            text: `✅ *𝙈𝙀𝙈𝘽𝙀𝙍 𝘼𝘿𝘿𝙀𝘿*\n\n${args[0]} 𝙝𝙖𝙨 𝙗𝙚𝙚𝙣 𝙨𝙪𝙘𝙘𝙚𝙨𝙨𝙛𝙪𝙡𝙡𝙮 𝙖𝙙𝙙𝙚𝙙 𝙩𝙤 𝙩𝙝𝙚 𝙜𝙧𝙤𝙪𝙥! 🎉\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Add command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *𝙁𝘼𝙄𝙇𝙀𝘿 𝙏𝙊 𝘼𝘿𝘿 𝙈𝙀𝙈𝘽𝙀𝙍!\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'kick': {
                    await socket.sendMessage(sender, { react: { text: '🦶', key: msg.key } });
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙏𝙃𝙄𝙎 𝘾𝙊𝙈𝙈𝘼𝙉𝘿 𝘾𝘼𝙉 𝙊𝙉𝙇𝙔 𝘽𝙀 𝙐𝙎𝙀𝘿 𝙄𝙉 𝙂𝙍𝙊𝙐𝙋𝙎!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙊𝙉𝙇𝙔 𝙂𝙍𝙊𝙐𝙋 𝘼𝘿𝙈𝙄𝙉𝙎 𝙊𝙍 𝘽𝙊𝙏 𝙊𝙒𝙉𝙀𝙍 𝘾𝘼𝙉 𝙆𝙄𝘾𝙆 𝙈𝙀𝙈𝘽𝙀𝙍𝙎!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (args.length === 0 && !msg.quoted) {
                        await socket.sendMessage(sender, {
                            text: `📌 *𝙐𝙎𝘼𝙂𝙀:* ${config.PREFIX}kick +255612491554 𝙤𝙧 𝙧𝙚𝙥𝙡𝙮 𝙬𝙞𝙩𝙝 ${config.PREFIX}kick`
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                        let numberToKick;
                        if (msg.quoted) {
                            numberToKick = msg.quoted.sender;
                        } else {
                            numberToKick = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        }
                        await socket.groupParticipantsUpdate(from, [numberToKick], 'remove');
                        await socket.sendMessage(sender, {
                            text: `🗑️ *𝙈𝙀𝙈𝘽𝙀𝙍 𝙆𝙄𝘾𝙆𝙀𝘿*\n\n${numberToKick.split('@')[0]} 𝙝𝙖𝙨 𝙗𝙚𝙚𝙣 𝙨𝙪𝙘𝙘𝙚𝙨𝙨𝙛𝙪𝙡𝙡𝙮 𝙧𝙚𝙢𝙤𝙫𝙚𝙙 𝙛𝙧𝙤𝙢 𝙩𝙝𝙚 𝙜𝙧𝙤𝙪𝙥! 🚪\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Kick command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *𝙁𝘼𝙄𝙇𝙀𝘿 𝙏𝙊 𝙆𝙄𝘾𝙆 𝙈𝙀𝙈𝘽𝙀𝙍!*\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'promote': {
                    await socket.sendMessage(sender, { react: { text: '👑', key: msg.key } });
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙏𝙃𝙄𝙎 𝘾𝙊𝙈𝙈𝘼𝙉𝘿 𝘾𝘼𝙉 𝙊𝙉𝙇𝙔 𝘽𝙀 𝙐𝙎𝙀𝘿 𝙄𝙉 𝙂𝙍𝙊𝙐𝙋𝙎!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙊𝙉𝙇𝙔 𝙂𝙍𝙊𝙐𝙋 𝘼𝘿𝙈𝙄𝙉𝙎 𝙊𝙍 𝘽𝙊𝙏 𝙊𝙒𝙉𝙀𝙍 𝘾𝘼𝙉 𝙋𝙍𝙊𝙈𝙊𝙏𝙀 𝙈𝙀𝙈𝘽𝙀𝙍𝙎!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (args.length === 0 && !msg.quoted) {
                        await socket.sendMessage(sender, {
                            text: `📌 *𝙐𝙎𝘼𝙂𝙀:* ${config.PREFIX}promote +255612491554 𝙤𝙧 𝙧𝙚𝙥𝙡𝙮 𝙬𝙞𝙩𝙝 ${config.PREFIX}promote`
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                        let numberToPromote;
                        if (msg.quoted) {
                            numberToPromote = msg.quoted.sender;
                        } else {
                            numberToPromote = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        }
                        await socket.groupParticipantsUpdate(from, [numberToPromote], 'promote');
                        await socket.sendMessage(sender, {
                            text: `⬆️ *𝙈𝙀𝙈𝘽𝙀𝙍 𝙋𝙍𝙊𝙈𝙊𝙏𝙀𝘿*\n\n${numberToPromote.split('@')[0]} 𝙝𝙖𝙨 𝙗𝙚𝙚𝙣 𝙨𝙪𝙘𝙘𝙚𝙨𝙨𝙛𝙪𝙡𝙡𝙮 𝙥𝙧𝙤𝙢𝙤𝙩𝙚𝙙 𝙩𝙤 𝙜𝙧𝙤𝙪𝙥 𝙖𝙙𝙢𝙞𝙣! 🌟\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Promote command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *𝙁𝘼𝙄𝙇𝙀𝘿 𝙏𝙊 𝙋𝙍𝙊𝙈𝙊𝙏𝙀 𝙈𝙀𝙈𝘽𝙀𝙍!*\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'demote': {
                    await socket.sendMessage(sender, { react: { text: '🙆‍♀️', key: msg.key } });
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙏𝙃𝙄𝙎 𝘾𝙊𝙈𝙈𝘼𝙉𝘿 𝘾𝘼𝙉 𝙊𝙉𝙇𝙔 𝘽𝙀 𝙐𝙎𝙀𝘿 𝙄𝙉 𝙂𝙍𝙊𝙐𝙋𝙎!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙊𝙉𝙇𝙔 𝙂𝙍𝙊𝙐𝙋 𝘼𝘿𝙈𝙄𝙉𝙎 𝙊𝙍 𝘽𝙊𝙏 𝙊𝙒𝙉𝙀𝙍 𝘾𝘼𝙉 𝘿𝙀𝙈𝙊𝙏𝙀 𝘼𝘿𝙈𝙄𝙉𝙎!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (args.length === 0 && !msg.quoted) {
                        await socket.sendMessage(sender, {
                            text: `📌 *𝙐𝙎𝘼𝙂𝙀:* ${config.PREFIX}demote +255612491554 𝙤𝙧 𝙧𝙚𝙥𝙡𝙮 𝙬𝙞𝙩𝙝 ${config.PREFIX}demote`
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                        let numberToDemote;
                        if (msg.quoted) {
                            numberToDemote = msg.quoted.sender;
                        } else {
                            numberToDemote = args[0].replace(/[^0-9]/g, '') + '@s.whatsapp.net';
                        }
                        await socket.groupParticipantsUpdate(from, [numberToDemote], 'demote');
                        await socket.sendMessage(sender, {
                            text: `⬇️ *𝘼𝘿𝙈𝙄𝙉 𝘿𝙀𝙈𝙊𝙏𝙀𝘿*\n\n${numberToDemote.split('@')[0]} 𝙝𝙖𝙨 𝙗𝙚𝙚𝙣 𝙨𝙪𝙘𝙘𝙚𝙨𝙨𝙛𝙪𝙡𝙡𝙮 𝙙𝙚𝙢𝙤𝙩𝙚𝙙 𝙛𝙧𝙤𝙢 𝙜𝙧𝙤𝙪𝙥 𝙖𝙙𝙢𝙞𝙣! 📉\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Demote command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *𝙁𝘼𝙄𝙇𝙀𝘿 𝙏𝙊 𝘿𝙀𝙈𝙊𝙏𝙀 𝘼𝘿𝙈𝙄𝙉!*\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'open': 
                case 'unmute': {
                    await socket.sendMessage(sender, { react: { text: '🔓', key: msg.key } });
                    
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙏𝙃𝙄𝙎 𝘾𝙊𝙈𝙈𝘼𝙉𝘿 𝘾𝘼𝙉 𝙊𝙉𝙇𝙔 𝘽𝙀 𝙐𝙎𝙀𝘿 𝙄𝙉 𝙂𝙍𝙊𝙐𝙋𝙎!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙊𝙉𝙇𝙔 𝙂𝙍𝙊𝙐𝙋 𝘼𝘿𝙈𝙄𝙉𝙎 𝙊𝙍 𝘽𝙊𝙏 𝙊𝙒𝙉𝙀𝙍 𝘾𝘼𝙉 𝙊𝙋𝙀𝙉 𝙏𝙃𝙀 𝙂𝙍𝙊𝙐𝙋!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    try {
                        await socket.groupSettingUpdate(from, 'not_announcement');
                        
                        await socket.sendMessage(sender, {
                            image: { url: 'https://files.catbox.moe/jwmx1j.jpg' },
                            caption: `🔓 *𝙂𝙍𝙊𝙐𝙋 𝙊𝙋𝙀𝙉𝙀𝘿*\n\n𝙂𝙧𝙤𝙪𝙥 𝙞𝙨 𝙣𝙤𝙬 𝙤𝙥𝙚𝙣! 𝘼𝙡𝙡 𝙢𝙚𝙢𝙗𝙚𝙧𝙨 𝙘𝙖𝙣 𝙨𝙚𝙣𝙙 𝙢𝙚𝙨𝙨𝙖𝙜𝙚𝙨. 🗣️\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Open command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *𝙁𝘼𝙄𝙇𝙀𝘿 𝙏𝙊 𝙊𝙋𝙀𝙉 𝙂𝙍𝙊𝙐𝙋!*\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'close': 
                case 'mute': {
                    await socket.sendMessage(sender, { react: { text: '🔒', key: msg.key } });
                    
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙏𝙃𝙄𝙎 𝘾𝙊𝙈𝙈𝘼𝙉𝘿 𝘾𝘼𝙉 𝙊𝙉𝙇𝙔 𝘽𝙀 𝙐𝙎𝙀𝘿 𝙄𝙉 𝙂𝙍𝙊𝙐𝙋𝙎!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙊𝙉𝙇𝙔 𝙂𝙍𝙊𝙐𝙋 𝘼𝘿𝙈𝙄𝙉𝙎 𝙊𝙍 𝘽𝙊𝙏 𝙊𝙒𝙉𝙀𝙍 𝘾𝘼𝙉 𝘾𝙇𝙊𝙎𝙀 𝙏𝙃𝙀 𝙂𝙍𝙊𝙐𝙋!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    
                    try {
                        await socket.groupSettingUpdate(from, 'announcement');
                        
                        await socket.sendMessage(sender, {
                            image: { url: 'https://files.catbox.moe/dlvrav.jpg' },
                            caption: `🔒 *𝙂𝙍𝙊𝙐𝙋 𝘾𝙇𝙊𝙎𝙀𝘿*\n\n𝙂𝙧𝙤𝙪𝙥 𝙞𝙨 𝙣𝙤𝙬 𝙘𝙡𝙤𝙨𝙚𝙙! 𝙊𝙣𝙡𝙮 𝙖𝙙𝙢𝙞𝙣𝙨 𝙘𝙖𝙣 𝙨𝙚𝙣𝙙 𝙢𝙚𝙨𝙜𝙨𝙖𝙜𝙚𝙨. 🤫\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Close command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *𝙁𝘼𝙄𝙇𝙀𝘿 𝙏𝙊 𝘾𝙇𝙊𝙎𝙀 𝙂𝙍𝙊𝙐𝙋!*\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'kickall':
                case 'removeall':
                case 'cleargroup': {
                    await socket.sendMessage(sender, { react: { text: '⚡', key: msg.key } });

                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙏𝙃𝙄𝙎 𝘾𝙊𝙈𝙈𝘼𝙉𝘿 𝘾𝘼𝙉 𝙊𝙉𝙇𝙔 𝘽𝙀 𝙐𝙎𝙀𝘿 𝙄𝙉 𝙂𝙍𝙊𝙐𝙋𝙎!*'
                        }, { quoted: fakevCard });
                        break;
                    }

                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙊𝙉𝙇𝙔 𝙂𝙍𝙊𝙐𝙋 𝘼𝘿𝙈𝙄𝙉𝙎 𝙊𝙍 𝘽𝙊𝙏 𝙊𝙒𝙉𝙀𝙍 𝘾𝘼𝙉 𝙐𝙎𝙀 𝙏𝙃𝙄𝙎 𝘾𝙊𝙈𝙈𝘼𝙉𝘿!*'
                        }, { quoted: fakevCard });
                        break;
                    }

                    try {
                        const groupMetadata = await socket.groupMetadata(from);
                        const botJid = socket.user?.id || socket.user?.jid;

                        const membersToRemove = groupMetadata.participants
                            .filter(p => p.admin === null && p.id !== botJid)
                            .map(p => p.id);

                        if (membersToRemove.length === 0) {
                            await socket.sendMessage(sender, {
                                text: '❌ *𝙉𝙊 𝙈𝙀𝙈𝘽𝙀𝙍𝙎 𝙏𝙊 𝙍𝙀𝙈𝙊𝙑𝙀 (𝘼𝙇𝙇 𝘼𝙍𝙀 𝘼𝘿𝙈𝙄𝙉𝙎 𝙊𝙍 𝘽𝙊𝙏).*'
                            }, { quoted: fakevCard });
                            break;
                        }

                        await socket.sendMessage(sender, {
                            text: `⚠️ *𝙒𝘼𝙍𝙉𝙄𝙉𝙂* ⚠️\n\n𝙍𝙚𝙢𝙤𝙫𝙞𝙣𝙜 *${membersToRemove.length}* 𝙢𝙚𝙢𝙗𝙚𝙧𝙨...`
                        }, { quoted: fakevCard });

                        const batchSize = 50;
                        for (let i = 0; i < membersToRemove.length; i += batchSize) {
                            const batch = membersToRemove.slice(i, i + batchSize);
                            await socket.groupParticipantsUpdate(from, batch, 'remove');
                            await new Promise(r => setTimeout(r, 2000));
                        }

                        await socket.sendMessage(sender, {
                            text: `🧹 *𝙂𝙍𝙊𝙐𝙋 𝘾𝙇𝙀𝘼𝙉𝙀𝘿*\n\n✅ 𝙎𝙪𝙘𝙘𝙚𝙨𝙨𝙛𝙪𝙡𝙡𝙮 𝙧𝙚𝙢𝙤𝙫𝙚𝙙 *${membersToRemove.length}* 𝙢𝙚𝙢𝙗𝙚𝙧𝙨.\n\n> *𝙀𝙭𝙚𝙘𝙪𝙩𝙚𝙙 𝙗𝙮:* @${m.sender.split('@')[0]}\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`,
                            mentions: [m.sender]
                        }, { quoted: fakevCard });

                    } catch (error) {
                        console.error('Kickall command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *𝙁𝘼𝙄𝙇𝙀𝘿 𝙏𝙊 𝙍𝙀𝙈𝙊𝙑𝙀 𝙈𝙀𝙈𝘽𝙀𝙍𝙎!*\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'tagall': {
                    await socket.sendMessage(sender, { react: { text: '🫂', key: msg.key } });
                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙏𝙃𝙄𝙎 𝘾𝙊𝙈𝙈𝘼𝙉𝘿 𝘾𝘼𝙉 𝙊𝙉𝙇𝙔 𝘽𝙀 𝙐𝙎𝙀𝘿 𝙄𝙉 𝙂𝙍𝙊𝙐𝙋𝙎!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙊𝙉𝙇𝙔 𝙂𝙍𝙊𝙐𝙋 𝘼𝘿𝙈𝙄𝙉𝙎 𝙊𝙍 𝘽𝙊𝙏 𝙊𝙒𝙉𝙀𝙍 𝘾𝘼𝙉 𝙏𝘼𝙂 𝘼𝙇𝙇 𝙈𝙀𝙈𝘽𝙀𝙍𝙎!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                        const groupMetadata = await socket.groupMetadata(from);
                        const participants = groupMetadata.participants;
                        
                        const adminCount = participants.filter(p => p.admin).length;
                        const userCount = participants.length - adminCount;
                        
                        let mentionsText = '';
                        participants.forEach(participant => {
                            mentionsText += `@${participant.id.split('@')[0]}\n`;
                        });

                        let message = args.join(' ') || '';
                        const senderName = msg.pushName || sender.split('@')[0];
                        
                        await socket.sendMessage(from, {
                            image: { url: "https://files.catbox.moe/jwmx1j.jpg" },
                            caption: `*╭━━━〔 🐢 𝙎𝙄𝙇𝘼 𝙈𝘿 🐢 〕━━━┈⊷*\n*┃🐢│ 𝙂𝙍𝙊𝙐𝙋 𝙉𝘼𝙈𝙀: ${groupMetadata.subject}*\n*┃🐢│ 𝙈𝙀𝙈𝘽𝙀𝙍𝙎: ${participants.length}*\n*┃🐢│ 𝘼𝘿𝙈𝙄𝙉𝙎: ${adminCount}*\n*┃🐢│ 𝙐𝙎𝙀𝙍: @${sender.split('@')[0]}*\n*┃🐢│ 𝙈𝙀𝙎𝙎𝘼𝙂𝙀: ${message}*\n*╰━━━━━━━━━━━━━━━┈⊷*\n\n> 🐢 𝙎𝙄𝙇𝘼 𝙈𝘿 𝙏𝘼𝙂𝘼𝙇𝙇\n\n${mentionsText}\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`,
                            mentions: [sender, ...participants.map(p => p.id)]
                        }, { quoted: msg });
                    } catch (error) {
                        console.error('Tagall command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *𝙁𝘼𝙄𝙇𝙀𝘿 𝙏𝙊 𝙏𝘼𝙂 𝘼𝙇𝙇 𝙈𝙀𝙈𝘽𝙀𝙍𝙎*\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'broadcast':
                case 'bc':
                case 'broadcaster': {
                    await socket.sendMessage(sender, { react: { text: '📢', key: msg.key } });

                    if (!isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙊𝙉𝙇𝙔 𝘽𝙊𝙏 𝙊𝙒𝙉𝙀𝙍 𝘾𝘼𝙉 𝙐𝙎𝙀 𝙏𝙃𝙄𝙎 𝘾𝙊𝙈𝙈𝘼𝙉𝘿!*'
                        }, { quoted: fakevCard });
                        break;
                    }

                    try {
                        const hasImage = msg.message?.imageMessage;
                        const hasVideo = msg.message?.videoMessage;
                        const caption = msg.message?.imageMessage?.caption || 
                                       msg.message?.videoMessage?.caption || '';

                        const broadcastMessage = caption || 
                                               msg.message?.conversation?.replace(/^[.\/!]broadcast\s*/i, '') || 
                                               msg.message?.extendedTextMessage?.text?.replace(/^[.\/!]broadcast\s*/i, '') || '';

                        if (!broadcastMessage && !hasImage && !hasVideo) {
                            await socket.sendMessage(sender, {
                                text: '📌 *𝙐𝙎𝘼𝙂𝙀:* .broadcast 𝙮𝙤𝙪𝙧 𝙢𝙚𝙨𝙨𝙖𝙜𝙚\n𝙤𝙧 𝙨𝙚𝙣𝙙 𝙞𝙢𝙖𝙜𝙚/𝙫𝙞𝙙𝙚𝙤 𝙬𝙞𝙩𝙝 𝙘𝙖𝙥𝙩𝙞𝙤𝙣'
                            }, { quoted: fakevCard });
                            break;
                        }

                        const groupChats = Object.values(socket.chats)
                            .filter(chat => chat.id.endsWith('@g.us') && !chat.read_only);

                        if (groupChats.length === 0) {
                            await socket.sendMessage(sender, {
                                text: '❌ *𝘽𝙊𝙏 𝙄𝙎 𝙉𝙊𝙏 𝙄𝙉 𝘼𝙉𝙔 𝙂𝙍𝙊𝙐𝙋𝙎!*'
                            }, { quoted: fakevCard });
                            break;
                        }

                        await socket.sendMessage(sender, {
                            text: `*╭━━━〔 🐢 𝙎𝙄𝙇𝘼 𝙈𝘿 🐢 〕━━━┈⊷*\n*┃🐢│ 📢 𝙎𝙏𝘼𝙍𝙏𝙄𝙉𝙂 𝘽𝙍𝙊𝘼𝘿𝘾𝘼𝙎𝙏*\n*┃🐢│ 𝙏𝙊: ${groupChats.length} 𝙂𝙍𝙊𝙐𝙋𝙎*\n*╰━━━━━━━━━━━━━━━┈⊷*`
                        }, { quoted: fakevCard });

                        let successCount = 0;
                        let failCount = 0;

                        for (const group of groupChats) {
                            try {
                                if (hasImage) {
                                    await socket.sendMessage(group.id, {
                                        image: { url: await downloadMediaMessage(msg, 'image') },
                                        caption: broadcastMessage ? `*╭━━━〔 🐢 𝙎𝙄𝙇𝘼 𝙈𝘿 🐢 〕━━━┈⊷*\n*┃🐢│ 📢 𝘽𝙍𝙊𝘼𝘿𝘾𝘼𝙎𝙏*\n*┃🐢│*\n*┃🐢│ ${broadcastMessage}*\n*╰━━━━━━━━━━━━━━━┈⊷*\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼` : undefined
                                    });
                                } else if (hasVideo) {
                                    await socket.sendMessage(group.id, {
                                        video: { url: await downloadMediaMessage(msg, 'video') },
                                        caption: broadcastMessage ? `*╭━━━〔 🐢 𝙎𝙄𝙇𝘼 𝙈𝘿 🐢 〕━━━┈⊷*\n*┃🐢│ 📢 𝘽𝙍𝙊𝘼𝘿𝘾𝘼𝙎𝙏*\n*┃🐢│*\n*┃🐢│ ${broadcastMessage}*\n*╰━━━━━━━━━━━━━━━┈⊷*\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼` : undefined
                                    });
                                } else {
                                    await socket.sendMessage(group.id, {
                                        text: `*╭━━━〔 🐢 𝙎𝙄𝙇𝘼 𝙈𝘿 🐢 〕━━━┈⊷*\n*┃🐢│ 📢 𝘽𝙍𝙊𝘼𝘿𝘾𝘼𝙎𝙏 𝙈𝙀𝙎𝙎𝘼𝙂𝙀*\n*┃🐢│*\n*┃🐢│ ${broadcastMessage}*\n*╰━━━━━━━━━━━━━━━┈⊷*\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
                                    });
                                }
                                successCount++;
                                await new Promise(resolve => setTimeout(resolve, 300));
                            } catch (error) {
                                console.error(`Failed to send to ${group.id}:`, error);
                                failCount++;
                            }
                        }

                        await socket.sendMessage(sender, {
                            text: `*╭━━━〔 🐢 𝙎𝙄𝙇𝘼 𝙈𝘿 🐢 〕━━━┈⊷*\n*┃🐢│ ✅ 𝘽𝙍𝙊𝘼𝘿𝘾𝘼𝙎𝙏 𝘾𝙊𝙈𝙋𝙇𝙀𝙏𝙀𝘿*\n*┃🐢│*\n*┃🐢│ 📊 𝙍𝙀𝙎𝙐𝙇𝙏𝙎:*\n*┃🐢│ ✅ 𝙎𝙪𝙘𝙘𝙚𝙨𝙨: ${successCount}*\n*┃🐢│ ❌ 𝙁𝙖𝙞𝙡𝙚𝙙: ${failCount}*\n*┃🐢│ 📋 𝙏𝙤𝙩𝙖𝙡: ${groupChats.length}*\n*╰━━━━━━━━━━━━━━━┈⊷*`
                        }, { quoted: fakevCard });

                    } catch (error) {
                        console.error('Broadcast command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *𝘽𝙍𝙊𝘼𝘿𝘾𝘼𝙎𝙏 𝙁𝘼𝙄𝙇𝙀𝘿*\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'warn': {
                    await socket.sendMessage(sender, { react: { text: '⚠️', key: msg.key } });

                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙏𝙃𝙄𝙎 𝘾𝙊𝙈𝙈𝘼𝙉𝘿 𝘾𝘼𝙉 𝙊𝙉𝙇𝙔 𝘽𝙀 𝙐𝙎𝙀𝘿 𝙄𝙉 𝙂𝙍𝙊𝙐𝙋𝙎!*'
                        }, { quoted: fakevCard });
                        break;
                    }

                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙊𝙉𝙇𝙔 𝙂𝙍𝙊𝙐𝙋 𝘼𝘿𝙈𝙄𝙉𝙎 𝙊𝙍 𝘽𝙊𝙏 𝙊𝙒𝙉𝙀𝙍 𝘾𝘼𝙉 𝙒𝘼𝙍𝙉 𝙈𝙀𝙈𝘽𝙀𝙍𝙎!*'
                        }, { quoted: fakevCard });
                        break;
                    }

                    try {
                        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                        let targetUser = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                                        msg.message?.extendedTextMessage?.contextInfo?.participant;

                        if (!targetUser) {
                            targetUser = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] ||
                                        m.mentionedJid?.[0];
                        }

                        if (!targetUser) {
                            await socket.sendMessage(sender, {
                                text: '📌 *𝙐𝙎𝘼𝙂𝙀:*\n𝙍𝙚𝙥𝙡𝙮 𝙩𝙤 𝙪𝙨𝙚𝙧 𝙤𝙧 𝙩𝙖𝙜 𝙨𝙤𝙢𝙚𝙤𝙣𝙚\n.warn @user'
                            }, { quoted: fakevCard });
                            break;
                        }

                        if (targetUser === m.sender) {
                            await socket.sendMessage(sender, {
                                text: '❌ *𝙔𝙊𝙐 𝘾𝘼𝙉𝙉𝙊𝙏 𝙒𝘼𝙍𝙉 𝙔𝙊𝙐𝙍𝙎𝙀𝙇𝙁!*'
                            }, { quoted: fakevCard });
                            break;
                        }

                        const groupMetadata = await socket.groupMetadata(from);
                        const targetIsAdmin = groupMetadata.participants.find(p => p.id === targetUser)?.admin;

                        if (targetIsAdmin && !isOwner) {
                            await socket.sendMessage(sender, {
                                text: '❌ *𝘾𝘼𝙉𝙉𝙊𝙏 𝙒𝘼𝙍𝙉 𝙂𝙍𝙊𝙐𝙋 𝘼𝘿𝙈𝙄𝙉𝙎!*'
                            }, { quoted: fakevCard });
                            break;
                        }

                        const warnReason = args.slice(1).join(' ') || '𝙉𝙤 𝙧𝙚𝙖𝙨𝙤𝙣 𝙥𝙧𝙤𝙫𝙞𝙙𝙚𝙙';

                        await socket.sendMessage(from, {
                            text: `*╭━━━〔 🐢 𝙎𝙄𝙇𝘼 𝙈𝘿 🐢 〕━━━┈⊷*\n*┃🐢│ ⚠️  𝙒𝘼𝙍𝙉𝙄𝙉𝙂 𝙄𝙎𝙎𝙐𝙀𝘿*\n*┃🐢│*\n*┃🐢│ 𝙏𝙖𝙧𝙜𝙚𝙩: @${targetUser.split('@')[0]}*\n*┃🐢│ 𝙍𝙚𝙖𝙨𝙤𝙣: ${warnReason}*\n*┃🐢│ 𝘽𝙮: @${m.sender.split('@')[0]}*\n*╰━━━━━━━━━━━━━━━┈⊷*\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`,
                            mentions: [targetUser, m.sender]
                        }, { quoted: msg });

                    } catch (error) {
                        console.error('Warn command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *𝙁𝘼𝙄𝙇𝙀𝘿 𝙏𝙊 𝙒𝘼𝙍𝙉 𝙐𝙎𝙀𝙍*\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'setname': {
                    await socket.sendMessage(sender, { react: { text: '🏷️', key: msg.key } });

                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙏𝙃𝙄𝙎 𝘾𝙊𝙈𝙈𝘼𝙉𝘿 𝘾𝘼𝙉 𝙊𝙉𝙇𝙔 𝘽𝙀 𝙐𝙎𝙀𝘿 𝙄𝙉 𝙂𝙍𝙊𝙐𝙋𝙎!*'
                        }, { quoted: fakevCard });
                        break;
                    }

                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙊𝙉𝙇𝙔 𝙂𝙍𝙊𝙐𝙋 𝘼𝘿𝙈𝙄𝙉𝙎 𝙊𝙍 𝘽𝙊𝙏 𝙊𝙒𝙉𝙀𝙍 𝘾𝘼𝙉 𝘾𝙃𝘼𝙉𝙂𝙀 𝙂𝙍𝙊𝙐𝙋 𝙉𝘼𝙈𝙀!*'
                        }, { quoted: fakevCard });
                        break;
                    }

                    try {
                        const newName = args.slice(1).join(' ').trim();

                        if (!newName) {
                            await socket.sendMessage(sender, {
                                text: '📌 *𝙐𝙎𝘼𝙂𝙀:* .setname 𝙉𝙚𝙬 𝙂𝙧𝙤𝙪𝙥 𝙉𝙖𝙢𝙚'
                            }, { quoted: fakevCard });
                            break;
                        }

                        if (newName.length > 25) {
                            await socket.sendMessage(sender, {
                                text: '❌ *𝙂𝙍𝙊𝙐𝙋 𝙉𝘼𝙈𝙀 𝙏𝙊𝙊 𝙇𝙊𝙉𝙂!*\n𝙈𝙖𝙭 25 𝙘𝙝𝙖𝙧𝙖𝙘𝙩𝙚𝙧𝙨'
                            }, { quoted: fakevCard });
                            break;
                        }

                        await socket.groupUpdateSubject(from, newName);

                        await socket.sendMessage(from, {
                            text: `*╭━━━〔 🐢 𝙎𝙄𝙇𝘼 𝙈𝘿 🐢 〕━━━┈⊷*\n*┃🐢│ ✅ 𝙂𝙍𝙊𝙐𝙋 𝙉𝘼𝙈𝙀 𝙐𝙋𝘿𝘼𝙏𝙀𝘿*\n*┃🐢│*\n*┃🐢│ 𝙉𝙚𝙬 𝙣𝙖𝙢𝙚: ${newName}*\n*┃🐢│ 𝘽𝙮: @${m.sender.split('@')[0]}*\n*╰━━━━━━━━━━━━━━━┈⊷*\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`,
                            mentions: [m.sender]
                        }, { quoted: msg });

                    } catch (error) {
                        console.error('Setname command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *𝙁𝘼𝙄𝙇𝙀𝘿 𝙏𝙊 𝘾𝙃𝘼𝙉𝙂𝙀 𝙂𝙍𝙊𝙐𝙋 𝙉𝘼𝙈𝙀*\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'grouplink':
                case 'linkgroup':
                case 'invite': {
                    await socket.sendMessage(sender, { react: { text: '🔗', key: msg.key } });

                    if (!isGroup) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙏𝙃𝙄𝙎 𝘾𝙊𝙈𝙈𝘼𝙉𝘿 𝘾𝘼𝙉 𝙊𝙉𝙇𝙔 𝘽𝙀 𝙐𝙎𝙀𝘿 𝙄𝙉 𝙂𝙍𝙊𝙐𝙋𝙎!*'
                        }, { quoted: fakevCard });
                        break;
                    }

                    if (!isSenderGroupAdmin && !isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙊𝙉𝙇𝙔 𝙂𝙍𝙊𝙐𝙋 𝘼𝘿𝙈𝙄𝙉𝙎 𝙊𝙍 𝘽𝙊𝙏 𝙊𝙒𝙉𝙀𝙍 𝘾𝘼𝙉 𝙂𝙀𝙏 𝙏𝙃𝙀 𝙂𝙍𝙊𝙐𝙋 𝙇𝙄𝙉𝙆!*'
                        }, { quoted: fakevCard });
                        break;
                    }

                    try {
                        const groupLink = await socket.groupInviteCode(from);
                        const fullLink = `https://chat.whatsapp.com/${groupLink}`;

                        await socket.sendMessage(sender, {
                            text: `🔗 *𝙂𝙍𝙊𝙐𝙋 𝙇𝙄𝙉𝙆*\n\n📌 *𝙃𝙀𝙍𝙀 𝙄𝙎 𝙏𝙃𝙀 𝙂𝙍𝙊𝙐𝙋 𝙇𝙄𝙉𝙆:*\n${fullLink}\n\n> *𝙍𝙀𝙌𝙐𝙀𝙎𝙏𝙀𝘿 𝘽𝙔:* @${m.sender.split('@')[0]}\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`,
                            mentions: [m.sender]
                        }, { quoted: fakevCard });

                    } catch (error) {
                        console.error('GroupLink command error:', error);
                        await socket.sendMessage(sender, {
                            text: `❌ *𝙁𝘼𝙄𝙇𝙀𝘿 𝙏𝙊 𝙂𝙀𝙏 𝙂𝙍𝙊𝙐𝙋 𝙇𝙄𝙉𝙆!*\nError: ${error.message || 'Unknown error'}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'join': {
                    if (!isOwner) {
                        await socket.sendMessage(sender, {
                            text: '❌ *𝙊𝙉𝙇𝙔 𝘽𝙊𝙏 𝙊𝙒𝙉𝙀𝙍 𝘾𝘼𝙉 𝙐𝙎𝙀 𝙏𝙃𝙄𝙎 𝘾𝙊𝙈𝙈𝘼𝙉𝘿!*'
                        }, { quoted: fakevCard });
                        break;
                    }
                    if (args.length === 0) {
                        await socket.sendMessage(sender, {
                            text: `📌 *𝙐𝙎𝘼𝙂𝙀:* ${config.PREFIX}join <group-invite-link>\n\nExample: ${config.PREFIX}join https://chat.whatsapp.com/xxxxxxxxxxxxxxxxxx`
                        }, { quoted: fakevCard });
                        break;
                    }
                    try {
                        await socket.sendMessage(sender, { react: { text: '👏', key: msg.key } });
                        const inviteLink = args[0];
                        const inviteCodeMatch = inviteLink.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
                        if (!inviteCodeMatch) {
                            await socket.sendMessage(sender, {
                                text: '❌ *𝙄𝙉𝙑𝘼𝙇𝙄𝘿 𝙂𝙍𝙊𝙐𝙋 𝙄𝙉𝙑𝙄𝙏𝙀 𝙇𝙄𝙉𝙆 𝙁𝙊𝙍𝙈𝘼𝙏!*'
                            }, { quoted: fakevCard });
                            break;
                        }
                        const inviteCode = inviteCodeMatch[1];
                        const response = await socket.groupAcceptInvite(inviteCode);
                        if (response?.gid) {
                            await socket.sendMessage(sender, {
                                text: `🤝 *𝙂𝙍𝙊𝙐𝙋 𝙅𝙊𝙄𝙉𝙀𝘿*\n\n𝙎𝙪𝙘𝙘𝙚𝙨𝙨𝙛𝙪𝙡𝙡𝙮 𝙟𝙤𝙞𝙣𝙚𝙙 𝙜𝙧𝙤𝙪𝙥 𝙬𝙞𝙩𝙝 𝙄𝘿: ${response.gid}! 🎉\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
                            }, { quoted: fakevCard });
                        } else {
                            throw new Error('No group ID in response');
                        }
                    } catch (error) {
                        console.error('Join command error:', error);
                        let errorMessage = error.message || 'Unknown error';
                        if (error.message.includes('not-authorized')) {
                            errorMessage = '𝘽𝙤𝙩 𝙞𝙨 𝙣𝙤𝙩 𝙖𝙪𝙩𝙝𝙤𝙧𝙞𝙯𝙚𝙙 𝙩𝙤 𝙟𝙤𝙞𝙣 (𝙥𝙤𝙨𝙨𝙞𝙗𝙡𝙮 𝙗𝙖𝙣𝙣𝙚𝙙)';
                        } else if (error.message.includes('conflict')) {
                            errorMessage = '𝘽𝙤𝙩 𝙞𝙨 𝙖𝙡𝙧𝙚𝙖𝙙𝙮 𝙖 𝙢𝙚𝙢𝙗𝙚𝙧 𝙤𝙛 𝙩𝙝𝙚 𝙜𝙧𝙤𝙪𝙥';
                        } else if (error.message.includes('gone')) {
                            errorMessage = '𝙂𝙧𝙤𝙪𝙥 𝙞𝙣𝙫𝙞𝙩𝙚 𝙡𝙞𝙣𝙠 𝙞𝙨 𝙞𝙣𝙫𝙖𝙡𝙞𝙙 𝙤𝙧 𝙚𝙭𝙥𝙞𝙧𝙚𝙙';
                        }
                        await socket.sendMessage(sender, {
                            text: `❌ *𝙁𝘼𝙄𝙇𝙀𝘿 𝙏𝙊 𝙅𝙊𝙄𝙉 𝙂𝙍𝙊𝙐𝙋!*\nError: ${errorMessage}`
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'quote': {
                    await socket.sendMessage(sender, { react: { text: '🤔', key: msg.key } });
                    try {
                        const response = await fetch('https://api.quotable.io/random');
                        const data = await response.json();
                        if (!data.content) {
                            throw new Error('No quote found');
                        }
                        await socket.sendMessage(sender, {
                            text: `💭 *𝙎𝙋𝙄𝘾𝙔 𝙌𝙐𝙊𝙏𝙀*\n\n📜 "${data.content}"\n— ${data.author}\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
                        }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Quote command error:', error);
                        await socket.sendMessage(sender, { text: '❌ 𝙊𝙝, 𝙨𝙬𝙚𝙚𝙩𝙞𝙚, 𝙩𝙝𝙚 𝙦𝙪𝙤𝙩𝙚𝙨 𝙜𝙤𝙩 𝙨𝙝𝙮! 😢 𝙏𝙧𝙮 𝙖𝙜𝙖𝙞𝙣?' }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'apk': {
                    try {
                        const appName = args.join(' ').trim();
                        if (!appName) {
                            await socket.sendMessage(sender, { text: '📌 𝙐𝙨𝙖𝙜𝙚: .apk <app name>\nExample: .apk whatsapp' }, { quoted: fakevCard });
                            break;
                        }

                        await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } });

                        const apiUrl = `https://api.nexoracle.com/downloader/apk?q=${encodeURIComponent(appName)}&apikey=free_key@maher_apis`;
                        console.log('Fetching APK from:', apiUrl);
                        const response = await fetch(apiUrl);
                        if (!response.ok) {
                            throw new Error(`API request failed with status: ${response.status}`);
                        }

                        const data = await response.json();
                        console.log('API Response:', JSON.stringify(data, null, 2));

                        if (!data || data.status !== 200 || !data.result || typeof data.result !== 'object') {
                            await socket.sendMessage(sender, { text: '❌ 𝙐𝙣𝙖𝙗𝙡𝙚 𝙩𝙤 𝙛𝙞𝙣𝙙 𝙩𝙝𝙚 𝘼𝙋𝙆. 𝙏𝙝𝙚 𝘼𝙋𝙄 𝙧𝙚𝙩𝙪𝙧𝙣𝙚𝙙 𝙞𝙣𝙫𝙖𝙡𝙞𝙙 𝙙𝙖𝙩𝙖.' }, { quoted: fakevCard });
                            break;
                        }

                        const { name, lastup, package, size, icon, dllink } = data.result;
                        if (!name || !dllink) {
                            console.error('Invalid result data:', data.result);
                            await socket.sendMessage(sender, { text: '❌ 𝙄𝙣𝙫𝙖𝙡𝙞𝙙 𝘼𝙋𝙆 𝙙𝙖𝙩𝙖: 𝙈𝙞𝙨𝙨𝙞𝙣𝙜 𝙣𝙖𝙢𝙚 𝙤𝙧 𝙙𝙤𝙬𝙣𝙡𝙤𝙖𝙙 𝙡𝙞𝙣𝙠.' }, { quoted: fakevCard });
                            break;
                        }

                        await socket.sendMessage(sender, {
                            image: { url: icon || 'https://via.placeholder.com/150' },
                            caption: `📦 *𝘿𝙊𝙒𝙉𝙇𝙊𝘼𝘿𝙄𝙉𝙂 𝘼𝙋𝙆*\n\n𝘿𝙤𝙬𝙣𝙡𝙤𝙖𝙙𝙞𝙣𝙜 ${name}... 𝙥𝙡𝙚𝙖𝙨𝙚 𝙬𝙖𝙞𝙩.\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
                        }, { quoted: fakevCard });

                        console.log('Downloading APK from:', dllink);
                        const apkResponse = await fetch(dllink, { headers: { 'Accept': 'application/octet-stream' } });
                        const contentType = apkResponse.headers.get('content-type');
                        if (!apkResponse.ok || (contentType && !contentType.includes('application/vnd.android.package-archive'))) {
                            throw new Error(`Failed to download APK: Status ${apkResponse.status}, Content-Type: ${contentType || 'unknown'}`);
                        }

                        const apkBuffer = await apkResponse.arrayBuffer();
                        if (!apkBuffer || apkBuffer.byteLength === 0) {
                            throw new Error('Downloaded APK is empty or invalid');
                        }
                        const buffer = Buffer.from(apkBuffer);

                        if (!buffer.slice(0, 2).toString('hex').startsWith('504b')) {
                            throw new Error('Downloaded file is not a valid APK');
                        }

                        await socket.sendMessage(sender, {
                            document: buffer,
                            mimetype: 'application/vnd.android.package-archive',
                            fileName: `${name.replace(/[^a-zA-Z0-9]/g, '_')}.apk`,
                            caption: `📦 *𝘼𝙋𝙆 𝘿𝙀𝙏𝘼𝙄𝙇𝙎*\n\n🔖 𝙣𝙖𝙢𝙚: ${name || 'N/A'}\n📅 𝙡𝙖𝙨𝙩 𝙪𝙥𝙙𝙖𝙩𝙚: ${lastup || 'N/A'}\n📦 𝙥𝙖𝙘𝙠𝙖𝙜𝙚: ${package || 'N/A'}\n📏 𝙎𝙞𝙯𝙚: ${size || 'N/A'}\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
                        }, { quoted: fakevCard });

                        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } });
                    } catch (error) {
                        console.error('APK command error:', error.message, error.stack);
                        await socket.sendMessage(sender, { text: `❌ 𝙊𝙝, 𝙡𝙤𝙫𝙚, 𝙘𝙤𝙪𝙡𝙙𝙣'𝙩 𝙛𝙚𝙩𝙘𝙝 𝙩𝙝𝙚 𝘼𝙋𝙆! 😢 𝙀𝙧𝙧𝙤𝙧: ${error.message}\n𝙏𝙧𝙮 𝙖𝙜𝙖𝙞𝙣 𝙡𝙖𝙩𝙚𝙧.` }, { quoted: fakevCard });
                        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } });
                    }
                    break;
                }

                case 'shorturl': {
                    try {
                        await socket.sendMessage(sender, { react: { text: '🔗', key: msg.key } });

                        const url = args.join(' ').trim();
                        if (!url) {
                            await socket.sendMessage(sender, {
                                text: `📌 *𝙐𝙎𝘼𝙂𝙀:* ${config.PREFIX}shorturl <𝙪𝙧𝙡>\n*𝙀𝙓𝘼𝙈𝙋𝙇𝙀:* ${config.PREFIX}shorturl https://example.com/very-long-url`
                            }, { quoted: msg });
                            break;
                        }
                        if (url.length > 2000) {
                            await socket.sendMessage(sender, {
                                text: `❌ *𝙐𝙍𝙇 𝙏𝙊𝙊 𝙇𝙊𝙉𝙂!*\n𝙋𝙡𝙚𝙖𝙨𝙚 𝙥𝙧𝙤𝙫𝙞𝙙𝙚 𝙖 𝙐𝙍𝙇 𝙪𝙣𝙙𝙚𝙧 2,000 𝙘𝙝𝙖𝙧𝙖𝙘𝙩𝙚𝙧𝙨.`
                            }, { quoted: msg });
                            break;
                        }
                        if (!/^https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)$/.test(url)) {
                            await socket.sendMessage(sender, {
                                text: `❌ *𝙄𝙉𝙑𝘼𝙇𝙄𝘿 𝙐𝙍𝙇!*\n𝙋𝙡𝙚𝙖𝙨𝙚 𝙥𝙧𝙤𝙫𝙞𝙙𝙚 𝙖 𝙫𝙖𝙡𝙞𝙙 𝙐𝙍𝙇 𝙨𝙩𝙖𝙧𝙩𝙞𝙣𝙜 𝙬𝙞𝙩𝙝 http:// 𝙤𝙧 https://.\n*𝙀𝙓𝘼𝙈𝙋𝙇𝙀:* ${config.PREFIX}shorturl https://example.com/very-long-url`
                            }, { quoted: msg });
                            break;
                        }

                        const response = await axios.get(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`, { timeout: 5000 });
                        const shortUrl = response.data.trim();

                        if (!shortUrl || !shortUrl.startsWith('https://is.gd/')) {
                            throw new Error('Failed to shorten URL or invalid response from is.gd');
                        }

                        await socket.sendMessage(sender, {
                            text: `✅ *𝙎𝙃𝙊𝙍𝙏 𝙐𝙍𝙇 𝘾𝙍𝙀𝘼𝙏𝙀𝘿!*\n\n🌐 *𝙊𝙍𝙄𝙂𝙄𝙉𝘼𝙇:* ${url}\n🔍 *𝙎𝙃𝙊𝙍𝙏𝙀𝙉𝙀𝘿:* ${shortUrl}\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
                        }, { 
                            quoted: msg
                        });

                        await new Promise(resolve => setTimeout(resolve, 2000));
                        await socket.sendMessage(sender, { text: shortUrl }, { quoted: msg });

                    } catch (error) {
                        console.error('Shorturl command error:', error.message);
                        let errorMessage = `❌ *𝘾𝙊𝙐𝙇𝘿𝙉'𝙏 𝙎𝙃𝙊𝙍𝙏𝙀𝙉 𝙏𝙃𝘼𝙏 𝙐𝙍𝙇!*\n💡 *𝙏𝙍𝙔 𝘼𝙂𝘼𝙄𝙉?*`;
                        if (error.message.includes('Failed to shorten') || error.message.includes('network') || error.message.includes('timeout')) {
                            errorMessage = `❌ *𝙁𝘼𝙄𝙇𝙀𝘿 𝙏𝙊 𝙎𝙃𝙊𝙍𝙏𝙀𝙉 𝙐𝙍𝙇:* ${error.message}\n💡 *𝙋𝙇𝙀𝘼𝙎𝙀 𝙏𝙍𝙔 𝘼𝙂𝘼𝙄𝙉 𝙇𝘼𝙏𝙀𝙍.*`;
                        }
                        await socket.sendMessage(sender, { text: errorMessage }, { quoted: msg });
                    }
                    break;
                }

                case 'weather': {
                    try {
                        await socket.sendMessage(sender, { react: { text: '🌦️', key: msg.key } });

                        if (!q || q.trim() === '') {
                            await socket.sendMessage(sender, {
                                text: `📌 *𝙐𝙎𝘼𝙂𝙀:* ${config.PREFIX}weather <𝙘𝙞𝙩𝙮>\n*𝙀𝙓𝘼𝙈𝙋𝙇𝙀:* ${config.PREFIX}weather 𝙃𝙖𝙞𝙩𝙞`
                            }, { quoted: msg });
                            break;
                        }

                        await socket.sendMessage(sender, {
                            text: `⏳ *𝙁𝙀𝙏𝘾𝙃𝙄𝙉𝙂 𝙒𝙀𝘼𝙏𝙃𝙀𝙍 𝘿𝘼𝙏𝘼...*`
                        }, { quoted: msg });

                        const apiKey = '2d61a72574c11c4f36173b627f8cb177';
                        const city = q.trim();
                        const url = `http://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`;

                        const response = await axios.get(url, { timeout: 5000 });
                        const data = response.data;

                        const weatherMessage = `
🌍 *𝙒𝙀𝘼𝙏𝙃𝙀𝙍 𝙄𝙉𝙁𝙊 𝙁𝙊𝙍* ${data.name}, ${data.sys.country}
🌡️ *𝙏𝙀𝙈𝙋𝙀𝙍𝘼𝙏𝙐𝙍𝙀:* ${data.main.temp}°C
🌡️ *𝙁𝙀𝙀𝙇𝙎 𝙇𝙄𝙆𝙀:* ${data.main.feels_like}°C
🌡️ *𝙈𝙄𝙉 𝙏𝙀𝙈𝙋:* ${data.main.temp_min}°C
🌡️ *𝙈𝘼𝙓 𝙏𝙀𝙈𝙋:* ${data.main.temp_max}°C
💧 *𝙃𝙐𝙈𝙄𝘿𝙄𝙏𝙔:* ${data.main.humidity}%
☁️ *𝙒𝙀𝘼𝙏𝙃𝙀𝙍:* ${data.weather[0].main}
🌫️ *𝘿𝙀𝙎𝘾𝙍𝙄𝙋𝙏𝙄𝙊𝙉:* ${data.weather[0].description}
💨 *𝙒𝙄𝙉𝘿 𝙎𝙋𝙀𝙀𝘿:* ${data.wind.speed} m/s
🔽 *𝙋𝙍𝙀𝙎𝙎𝙐𝙍𝙀:* ${data.main.pressure} hPa
        `;

                        await socket.sendMessage(sender, {
                            text: `🌤 *𝙒𝙀𝘼𝙏𝙃𝙀𝙍 𝙍𝙀𝙋𝙊𝙍𝙏* 🌤\n\n${weatherMessage}\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
                        }, { quoted: msg });

                    } catch (error) {
                        console.error('Weather command error:', error.message);
                        let errorMessage = `❌ *𝙊𝙃, 𝙇𝙊𝙑𝙀, 𝘾𝙊𝙐𝙇𝘿𝙉'𝙏 𝙁𝙀𝙏𝘾𝙃 𝙏𝙃𝙀 𝙒𝙀𝘼𝙏𝙃𝙀𝙍!*\n💡 *𝙏𝙍𝙔 𝘼𝙂𝘼𝙄𝙉?*`;
                        if (error.message.includes('404')) {
                            errorMessage = `🚫 *𝘾𝙄𝙏𝙔 𝙉𝙊𝙏 𝙁𝙊𝙐𝙉𝘿.*\n💡 *𝙋𝙇𝙀𝘼𝙎𝙀 𝘾𝙃𝙀𝘾𝙆 𝙏𝙃𝙀 𝙎𝙋𝙀𝙇𝙇𝙄𝙉𝙂 𝘼𝙉𝘿 𝙏𝙍𝙔 𝘼𝙂𝘼𝙄𝙉.*`;
                        } else if (error.message.includes('network') || error.message.includes('timeout')) {
                            errorMessage = `❌ *𝙁𝘼𝙄𝙇𝙀𝘿 𝙏𝙊 𝙁𝙀𝙏𝘾𝙃 𝙒𝙀𝘼𝙏𝙃𝙀𝙍:* ${error.message}\n💡 *𝙋𝙇𝙀𝘼𝙎𝙀 𝙏𝙍𝙔 𝘼𝙂𝘼𝙄𝙉 𝙇𝘼𝙏𝙀𝙍.*`;
                        }
                        await socket.sendMessage(sender, { text: errorMessage }, { quoted: msg });
                    }
                    break;
                }

                case 'savestatus': {
                    try {
                        await socket.sendMessage(sender, { react: { text: '💾', key: msg.key } });

                        if (!msg.quoted || !msg.quoted.statusMessage) {
                            await socket.sendMessage(sender, {
                                text: `📌 *𝙍𝙀𝙋𝙇𝙔 𝙏𝙊 𝘼 𝙎𝙏𝘼𝙏𝙐𝙎 𝙏𝙊 𝙎𝘼𝙑𝙀 𝙄𝙏!*`
                            }, { quoted: msg });
                            break;
                        }

                        await socket.sendMessage(sender, {
                            text: `⏳ *𝙎𝘼𝙑𝙄𝙉𝙂 𝙎𝙏𝘼𝙏𝙐𝙎...*`
                        }, { quoted: msg });

                        const media = await socket.downloadMediaMessage(msg.quoted);
                        const fileExt = msg.quoted.imageMessage ? 'jpg' : 'mp4';
                        const filePath = `./status_${Date.now()}.${fileExt}`;
                        fs.writeFileSync(filePath, media);

                        await socket.sendMessage(sender, {
                            text: `✅ *𝙎𝙏𝘼𝙏𝙐𝙎 𝙎𝘼𝙑𝙀𝘿!*\n📁 *𝙁𝙄𝙇𝙀:* status_${Date.now()}.${fileExt}\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`,
                            document: { url: filePath },
                            mimetype: msg.quoted.imageMessage ? 'image/jpeg' : 'video/mp4',
                            fileName: `status_${Date.now()}.${fileExt}`
                        }, { quoted: msg });

                    } catch (error) {
                        console.error('Savestatus command error:', error.message);
                        await socket.sendMessage(sender, {
                            text: `❌ *𝙊𝙃, 𝙇𝙊𝙑𝙀, 𝘾𝙊𝙐𝙇𝘿𝙉'𝙏 𝙎𝘼𝙑𝙀 𝙏𝙃𝘼𝙏 𝙎𝙏𝘼𝙏𝙐𝙎!*\n💡 *𝙏𝙍𝙔 𝘼𝙂𝘼𝙄𝙉?*`
                        }, { quoted: msg });
                    }
                    break;
                }

                case 'sticker':
                case 's': {
                    await socket.sendMessage(sender, { react: { text: '✨', key: msg.key } });

                    try {
                        let quoted = msg.quoted ? msg.quoted : msg;
                        let mime = (quoted.msg || quoted).mimetype || '';

                        if (!mime) {
                            return socket.sendMessage(from, { text: '⚠️ 𝙍𝙀𝙋𝙇𝙔 𝙒𝙄𝙏𝙃 𝘼𝙉 𝙄𝙈𝘼𝙂𝙀/𝙑𝙄𝘿𝙀𝙊 𝙏𝙊 𝙈𝘼𝙆𝙀 𝘼 𝙎𝙏𝙄𝘾𝙆𝙀𝙍!' }, { quoted: msg });
                        }

                        if (/image|video/.test(mime)) {
                            let media = await quoted.download();
                            await socket.sendMessage(from, { 
                                sticker: media 
                            }, { quoted: msg });
                        } else {
                            await socket.sendMessage(from, { text: '❌ 𝙊𝙉𝙇𝙔 𝙄𝙈𝘼𝙂𝙀 𝙊𝙍 𝙑𝙄𝘿𝙀𝙊 𝘼𝙇𝙇𝙊𝙒𝙀𝘿 𝙏𝙊 𝘾𝙍𝙀𝘼𝙏𝙀 𝙎𝙏𝙄𝘾𝙆𝙀𝙍!' }, { quoted: msg });
                        }
                    } catch (error) {
                        console.error('Error in .sticker command:', error);
                        await socket.sendMessage(from, { text: '💔 𝙁𝘼𝙄𝙇𝙀𝘿 𝙏𝙊 𝘾𝙍𝙀𝘼𝙏𝙀 𝙎𝙏𝙄𝘾𝙆𝙀𝙍. 𝙏𝙍𝙔 𝘼𝙂𝘼𝙄𝙉!' }, { quoted: msg });
                    }
                    break;
                }

                case 'url': {
                    try {
                        await socket.sendMessage(sender, { react: { text: '📤', key: msg.key || {} } });

                        console.log('Message:', JSON.stringify(msg, null, 2));
                        const quoted = msg.quoted || msg;
                        console.log('Quoted:', JSON.stringify(quoted, null, 2));
                        
                        let mime = quoted.mimetype || '';
                        if (!mime && quoted.message) {
                            const messageType = Object.keys(quoted.message)[0];
                            const mimeMap = {
                                imageMessage: 'image/jpeg',
                                videoMessage: 'video/mp4',
                                audioMessage: 'audio/mpeg',
                                documentMessage: 'application/octet-stream'
                            };
                            mime = mimeMap[messageType] || '';
                        }

                        console.log('MIME Type:', mime);

                        if (!mime || !['image', 'video', 'audio', 'application'].some(type => mime.includes(type))) {
                            await socket.sendMessage(sender, {
                                text: `❌ *𝙍𝙀𝙋𝙇𝙔 𝙏𝙊 𝙄𝙈𝘼𝙂𝙀, 𝘼𝙐𝘿𝙄𝙊, 𝙊𝙍 𝙑𝙄𝘿𝙀𝙊!*\n𝘿𝙚𝙩𝙚𝙘𝙩𝙚𝙙 𝙩𝙮𝙥𝙚: ${mime || 'none'}`
                            }, { quoted: msg });
                            break;
                        }

                        await socket.sendMessage(sender, {
                            text: `⏳ *𝙐𝙋𝙇𝙊𝘼𝘿𝙄𝙉𝙂 𝙁𝙄𝙇𝙀...*`
                        }, { quoted: msg });

                        const buffer = await socket.downloadMediaMessage(quoted);
                        if (!buffer || buffer.length === 0) {
                            throw new Error('Failed to download media: Empty buffer');
                        }

                        const ext = mime.includes('image/jpeg') ? '.jpg' :
                                    mime.includes('image/png') ? '.png' :
                                    mime.includes('image/gif') ? '.gif' :
                                    mime.includes('video') ? '.mp4' :
                                    mime.includes('audio') ? '.mp3' : '.bin';
                        
                        const name = `file_${Date.now()}${ext}`;
                        const tmp = path.join(os.tmpdir(), name);
                        
                        if (!fs.existsSync(os.tmpdir())) {
                            fs.mkdirSync(os.tmpdir(), { recursive: true });
                        }
                        
                        fs.writeFileSync(tmp, buffer);
                        console.log('Saved file to:', tmp);

                        const form = new FormData();
                        form.append('fileToUpload', fs.createReadStream(tmp), name);
                        form.append('reqtype', 'fileupload');

                        const res = await axios.post('https://catbox.moe/user/api.php', form, {
                            headers: form.getHeaders(),
                            timeout: 30000
                        });

                        if (fs.existsSync(tmp)) {
                            fs.unlinkSync(tmp);
                        }

                        if (!res.data || res.data.includes('error')) {
                            throw new Error(`Upload failed: ${res.data || 'No response data'}`);
                        }

                        const type = mime.includes('image') ? '𝙄𝙈𝘼𝙂𝙀' :
                                     mime.includes('video') ? '𝙑𝙄𝘿𝙀𝙊' :
                                     mime.includes('audio') ? '𝘼𝙐𝘿𝙄𝙊' : '𝙁𝙄𝙇𝙀';

                        await socket.sendMessage(sender, {
                            text: `✅ *${type} 𝙐𝙋𝙇𝙊𝘼𝘿𝙀𝘿!*\n\n📁 *𝙎𝙄𝙕𝙀:* ${formatBytes(buffer.length)}\n🔗 *𝙐𝙍𝙇:* ${res.data}\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
                        }, { quoted: msg });

                        await socket.sendMessage(sender, { react: { text: '✅', key: msg.key || {} } });
                    } catch (error) {
                        console.error('tourl2 error:', error.message, error.stack);
                        
                        if (tmp && fs.existsSync(tmp)) {
                            try {
                                fs.unlinkSync(tmp);
                            } catch (e) {
                                console.error('Error cleaning up temp file:', e.message);
                            }
                        }
                        
                        await socket.sendMessage(sender, {
                            text: `❌ *𝘾𝙊𝙐𝙇𝘿𝙉'𝙏 𝙐𝙋𝙇𝙊𝘼𝘿 𝙏𝙃𝘼𝙏 𝙁𝙄𝙇𝙀!*\n𝙀𝙧𝙧𝙤𝙧: ${error.message || '𝙨𝙤𝙢𝙚𝙩𝙝𝙞𝙣𝙜 𝙬𝙚𝙣𝙩 𝙬𝙧𝙤𝙣𝙜'}\n💡 *𝙏𝙍𝙔 𝘼𝙂𝘼𝙄𝙉?*`
                        }, { quoted: msg });
                        await socket.sendMessage(sender, { react: { text: '❌', key: msg.key || {} } });
                    }
                    break;
                }

                case 'whois': {
                    try {
                        await socket.sendMessage(sender, { react: { text: '👤', key: msg.key } });
                        const domain = args[0];
                        if (!domain) {
                            await socket.sendMessage(sender, { text: '📌 𝙐𝙨𝙖𝙜𝙚: .whois <domain>' }, { quoted: fakevCard });
                            break;
                        }
                        const response = await fetch(`http://api.whois.vu/?whois=${encodeURIComponent(domain)}`);
                        const data = await response.json();
                        if (!data.domain) {
                            throw new Error('Domain not found');
                        }
                        const whoisMessage = `🔍 *𝙒𝙃𝙊𝙄𝙎 𝙇𝙊𝙊𝙆𝙐𝙋*\n\n🌐 𝙙𝙤𝙢𝙖𝙞𝙣: ${data.domain}\n📅 𝙧𝙚𝙜𝙞𝙨𝙩𝙚𝙧𝙚𝙙: ${data.created_date || 'N/A'}\n⏰ 𝙚𝙭𝙥𝙞𝙧𝙚𝙨: ${data.expiry_date || 'N/A'}\n📋 𝙧𝙚𝙜𝙞𝙨𝙩𝙧𝙖𝙧: ${data.registrar || 'N/A'}\n📍 𝙨𝙩𝙖𝙩𝙪𝙨: ${data.status.join(', ') || 'N/A'}\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`;
                        await socket.sendMessage(sender, { text: whoisMessage }, { quoted: fakevCard });
                    } catch (error) {
                        console.error('Whois command error:', error);
                        await socket.sendMessage(sender, { text: '❌ 𝘾𝙤𝙪𝙡𝙙𝙣𝙩 𝙛𝙞𝙣𝙙 𝙩𝙝𝙖𝙩 𝙙𝙤𝙢𝙖𝙞𝙣! 😢 𝙏𝙧𝙮 𝙖𝙜𝙖𝙞𝙣?' }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'repo':
                case 'sc':
                case 'script': {
                    try {
                        await socket.sendMessage(sender, { react: { text: '🪄', key: msg.key } });
                        const githubRepoURL = 'https://github.com/Sila-Md/HAPA';
                        
                        const [, username, repo] = githubRepoURL.match(/github\.com\/([^/]+)\/([^/]+)/);
                        const response = await fetch(`https://api.github.com/repos/${username}/${repo}`);
                        
                        if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
                        
                        const repoData = await response.json();

                        const formattedInfo = `
*╭━━━〔 🐢 𝙎𝙄𝙇𝘼 𝙈𝘿 🐢 〕━━━┈⊷*
*┃🐢│ 𝙉𝘼𝙈𝙀: ${repoData.name}*
*┃🐢│ 𝙎𝙏𝘼𝙍𝙎: ${repoData.stargazers_count}*
*┃🐢│ 𝙁𝙊𝙍𝙆𝙎: ${repoData.forks_count}*
*┃🐢│ 𝙊𝙒𝙉𝙀𝙍: 𝙎𝙄𝙇𝘼*
*┃🐢│ 𝘿𝙀𝙎𝘾: ${repoData.description || '𝙉/𝘼'}*
*╰━━━━━━━━━━━━━━━┈⊷*

> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼
`;

                        await socket.sendMessage(sender, {
                            image: { url: 'https://files.catbox.moe/jwmx1j.jpg' },
                            caption: formattedInfo
                        }, { quoted: fakevCard });

                    } catch (error) {
                        console.error("❌ Error in repo command:", error);
                        await socket.sendMessage(sender, { 
                            text: "⚠️ 𝙁𝙖𝙞𝙡𝙚𝙙 𝙩𝙤 𝙛𝙚𝙩𝙘𝙝 𝙧𝙚𝙥𝙤 𝙞𝙣𝙛𝙤. 𝙋𝙡𝙚𝙖𝙨𝙚 𝙩𝙧𝙮 𝙖𝙜𝙖𝙞𝙣 𝙡𝙖𝙩𝙚𝙧." 
                        }, { quoted: fakevCard });
                    }
                    break;
                }

                case 'deleteme': {
                    const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                    if (fs.existsSync(sessionPath)) {
                        fs.removeSync(sessionPath);
                    }
                    await deleteSessionFromGitHub(number);
                    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
                        activeSockets.get(number.replace(/[^0-9]/g, '')).ws.close();
                        activeSockets.delete(number.replace(/[^0-9]/g, ''));
                        socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                    }
                    await socket.sendMessage(sender, {
                        image: { url: 'https://files.catbox.moe/jwmx1j.jpg' },
                        caption: `🗑️ *𝙎𝙀𝙎𝙎𝙄𝙊𝙉 𝘿𝙀𝙇𝙀𝙏𝙀𝘿*\n\n✅ 𝙔𝙤𝙪𝙧 𝙨𝙚𝙨𝙨𝙞𝙤𝙣 𝙝𝙖𝙨 𝙗𝙚𝙚𝙣 𝙨𝙪𝙘𝙘𝙚𝙨𝙨𝙛𝙪𝙡𝙡𝙮 𝙙𝙚𝙡𝙚𝙩𝙚𝙙.\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
                    });
                    break;
                }

                default:
                    break;
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: 'https://files.catbox.moe/jwmx1j.jpg' },
                caption: `❌ *𝙀𝙍𝙍𝙊𝙍*\n\n𝘼𝙣 𝙚𝙧𝙧𝙤𝙧 𝙤𝙘𝙘𝙪𝙧𝙧𝙚𝙙 𝙬𝙝𝙞𝙡𝙚 𝙥𝙧𝙤𝙘𝙚𝙨𝙨𝙞𝙣𝙜 𝙮𝙤𝙪𝙧 𝙘𝙤𝙢𝙢𝙖𝙣𝙙. 𝙋𝙡𝙚𝙖𝙨𝙚 𝙩𝙧𝙮 𝙖𝙜𝙖𝙞𝙣.\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
            });
        }
    });
}

function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === '120363402325089913@newsletter') return;

        if (config.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
    });
}

function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === 401) { // 401 indicates user-initiated logout
                console.log(`User ${number} logged out. Deleting session...`);
                
                // Delete session from MongoDB
                await deleteSessionFromGitHub(number);
                
                // Delete local session folder
                const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                if (fs.existsSync(sessionPath)) {
                    fs.removeSync(sessionPath);
                    console.log(`Deleted local session folder for ${number}`);
                }

                // Remove from active sockets
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));

                // Notify user      
                try {
                    await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                        image: { url: 'https://files.catbox.moe/jwmx1j.jpg' },
                        caption: `🗑️ *𝙎𝙀𝙎𝙎𝙄𝙊𝙉 𝘿𝙀𝙇𝙀𝙏𝙀𝘿*\n\n✅ 𝙔𝙤𝙪𝙧 𝙨𝙚𝙨𝙨𝙞𝙤𝙣 𝙝𝙖𝙨 𝙗𝙚𝙚𝙣 𝙙𝙚𝙡𝙚𝙩𝙚𝙙 𝙙𝙪𝙚 𝙩𝙤 𝙡𝙤𝙜𝙤𝙪𝙩.\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
                    });
                } catch (error) {
                    console.error(`Failed to notify ${number} about session deletion:`, error);
                }

                console.log(`Session cleanup completed for ${number}`);
            } else {
                // Existing reconnect logic
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                await delay(10000);
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await cleanDuplicateFiles(sanitizedNumber);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code: ${retries}, error.message`, retries);
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            const creds = JSON.parse(fileContent);
            
            // Save to MongoDB instead of GitHub
            await Session.findOneAndUpdate(
                { number: sanitizedNumber },
                { 
                    $set: {
                        creds: creds,
                        updatedAt: new Date()
                    }
                },
                { upsert: true }
            );
            
            console.log(`Updated creds for ${sanitizedNumber} in MongoDB`);
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    const groupResult = await joinGroup(socket);

                    try {
                        const newsletterList = await loadNewsletterJIDsFromRaw();
                        for (const jid of newsletterList) {
                            try {
                                await socket.newsletterFollow(jid);
                                await socket.sendMessage(jid, { react: { text: '❤️', key: { id: '1' } } });
                                console.log(`✅ Followed and reacted to newsletter: ${jid}`);
                            } catch (err) {
                                console.warn(`⚠️ Failed to follow/react to ${jid}:`, err.message);
                            }
                        }
                        console.log('✅ Auto-followed newsletter & reacted');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message);
                    }

                    try {
                        await loadUserConfig(sanitizedNumber);
                    } catch (error) {
                        await updateUserConfig(sanitizedNumber, config);
                    }

                    activeSockets.set(sanitizedNumber, socket);

                    const groupStatus = groupResult.status === 'success'
                        ? '𝙟𝙤𝙞𝙣𝙚𝙙 𝙨𝙪𝙘𝙘𝙚𝙨𝙨𝙛𝙪𝙡𝙡𝙮'
                        : `𝙛𝙖𝙞𝙡𝙚𝙙 𝙩𝙤 𝙟𝙤𝙞𝙣 𝙜𝙧𝙤𝙪𝙥: ${groupResult.error}`;

                    // Welcome message with new design
                    await socket.sendMessage(userJid, {
                        image: { url: 'https://files.catbox.moe/jwmx1j.jpg' },
                        caption: `*╭━━━〔 🐢 𝙎𝙄𝙇𝘼 𝙈𝘿 🐢 〕━━━┈⊷*\n*┃🐢│ 𝙎𝙐𝘾𝘾𝙀𝙎𝙎𝙁𝙐𝙇𝙇𝙔 𝘾𝙊𝙉𝙉𝙀𝘾𝙏𝙀𝘿!*\n*┃🐢│ 𝙉𝙐𝙈𝘽𝙀𝙍: ${sanitizedNumber}*\n*┃🐢│ 𝘾𝙊𝙉𝙉𝙀𝘲𝙏𝙀𝘿: ${new Date().toLocaleString()}*\n*┃🐢│ 𝙏𝙔𝙋𝙀 *${config.PREFIX}𝙈𝙀𝙉𝙐* 𝙏𝙊 𝙂𝙀𝙏 𝙎𝙏𝘼𝙍𝙏𝙀𝘿!*\n*┃🐢│ 𝙑𝙀𝙍𝙎𝙄𝙊𝙉 1.0.0 𝙉𝙀𝙒 𝘽𝙊𝙏🐢*\n*╰━━━━━━━━━━━━━━━┈⊷*\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
                    });

                    await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);

                    // Improved file handling with error checking
                    let numbers = [];
                    try {
                        if (fs.existsSync(NUMBER_LIST_PATH)) {
                            const fileContent = fs.readFileSync(NUMBER_LIST_PATH, 'utf8');
                            numbers = JSON.parse(fileContent) || [];
                        }
                        
                        if (!numbers.includes(sanitizedNumber)) {
                            numbers.push(sanitizedNumber);
                            
                            // Create backup before writing
                            if (fs.existsSync(NUMBER_LIST_PATH)) {
                                fs.copyFileSync(NUMBER_LIST_PATH, NUMBER_LIST_PATH + '.backup');
                            }
                            
                            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                            console.log(`📝 Added ${sanitizedNumber} to number list`);
                            
                            // Update numbers in MongoDB
                            await updateNumberListOnGitHub(sanitizedNumber);
                        }
                    } catch (fileError) {
                        console.error(`❌ File operation failed:`, fileError.message);
                        // Continue execution even if file operations fail
                    }
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || '𝙎𝙄𝙇𝘼-𝙈𝘿 𝙈𝘼𝙄𝙉'}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.status(200).send({
        status: 'active',
        message: '𝙎𝙄𝙇𝘼-𝙈𝘿',
        activesession: activeSockets.size
    });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        // Get all sessions from MongoDB
        const sessions = await Session.find({}).sort({ updatedAt: -1 });

        if (sessions.length === 0) {
            return res.status(404).send({ error: 'No session files found in MongoDB' });
        }

        const results = [];
        for (const session of sessions) {
            const number = session.number;
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                results.push({ number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${number}:`, error);
                results.push({ number, status: 'failed', error: error.message });
            }
            await delay(1000);
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }

    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const otp = generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });

    try {
        await sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }

    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }

    try {
        await updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        const socket = activeSockets.get(sanitizedNumber);
        if (socket) {
            await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                image: { url: 'https://files.catbox.moe/jwmx1j.jpg' },
                caption: `📌 *𝘾𝙊𝙉𝙁𝙄𝙂 𝙐𝙋𝘿𝘼𝙏𝙀𝘿*\n\n𝙔𝙤𝙪𝙧 𝙘𝙤𝙣𝙛𝙞𝙜𝙪𝙧𝙖𝙩𝙞𝙤𝙣 𝙝𝙖𝙨 𝙗𝙚𝙚𝙣 𝙨𝙪𝙘𝙘𝙎𝙚𝙨𝙨𝙛𝙪𝙡𝙡𝙮 𝙪𝙥𝙙𝙖𝙩𝙚𝙙!\n\n> © 𝙋𝙊𝙒𝙀𝙍𝘿 𝘽𝙔 🐢 𝙎𝙄𝙇𝘼`
            });
        }
        res.status(200).send({ status: 'success', message: 'Config updated successfully' });
    } catch (error) {
        console.error('Failed to update config:', error);
        res.status(500).send({ error: 'Failed to update config' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Africa/Nairobi').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({
            status: 'success',
            number: target,
            about: aboutStatus,
            setAt: setAt
        });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({
            status: 'error',
            message: `Failed to fetch About status for ${target}. The number may not exist or the status is not accessible.`
        });
    }
});

// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || '𝙎𝙄𝙇𝘼-𝙈𝘿-𝙈𝘼𝙄𝙉'}`);
});

async function autoReconnectFromGitHub() {
    try {
        // Get all numbers from MongoDB
        const sessions = await Session.find({}).sort({ updatedAt: -1 });

        for (const session of sessions) {
            const number = session.number;
            if (!activeSockets.has(number)) {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
                console.log(`🔁 Reconnected from MongoDB: ${number}`);
                await delay(1000);
            }
        }
    } catch (error) {
        console.error('❌ autoReconnectFromMongoDB error:', error.message);
    }
}

// Start auto reconnect
autoReconnectFromGitHub();

module.exports = router;

async function loadNewsletterJIDsFromRaw() {
    try {
        const res = await axios.get('https://raw.githubusercontent.com/mbwa-md/jid/refs/heads/main/newsletter_list.json');
        return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
        console.error('❌ Failed to load newsletter list from GitHub:', err.message);
        return [];
    }
}

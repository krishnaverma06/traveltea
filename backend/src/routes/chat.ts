import { Router } from 'express';
import * as chatController from '../controllers/chatController.js';
import auth from '../middleware/auth.js';

const router = Router();

/**
 * Chat Routes
 */
router.use(auth);

// Send a message
router.post('/', chatController.sendMessage);

// Get conversation history
router.get('/:conversationId', chatController.getConversation);

// Delete conversation
router.delete('/:conversationId', chatController.deleteConversation);

// List all conversations
router.get('/', chatController.listConversations);

export default router;
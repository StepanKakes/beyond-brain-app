import express from 'express';
import bcrypt from 'bcrypt';
import { userDb } from '../modules/database/index.js';
import { getConnection } from '../modules/database/connection.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import { personForUser } from '../services/beyond-people.js';

const router = express.Router();
const db = getConnection();

// Check auth status and setup requirements
router.get('/status', async (req, res) => {
  try {
    const hasUsers = await userDb.hasUsers();
    res.json({ 
      needsSetup: !hasUsers,
      isAuthenticated: false // Will be overridden by frontend if token exists
    });
  } catch (error) {
    console.error('Auth status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User registration (setup) - only allowed if no users exist
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    if (username.length < 3 || password.length < 6) {
      return res.status(400).json({ error: 'Username must be at least 3 characters, password at least 6 characters' });
    }
    
    // Use a transaction to prevent race conditions
    db.prepare('BEGIN').run();
    try {
      // Check if users already exist (only allow one user)
      const hasUsers = userDb.hasUsers();
      if (hasUsers) {
        db.prepare('ROLLBACK').run();
        return res.status(403).json({ error: 'User already exists. This is a single-user system.' });
      }
      
      // Hash password
      const saltRounds = 12;
      const passwordHash = await bcrypt.hash(password, saltRounds);
      
      // Create user
      const user = userDb.createUser(username, passwordHash);
      
      // Generate token
      const token = generateToken(user);
      
      db.prepare('COMMIT').run();

      // Update last login (non-fatal, outside transaction)
      userDb.updateLastLogin(user.id);

      res.json({
        success: true,
        user: { id: user.id, username: user.username },
        token
      });
    } catch (error) {
      db.prepare('ROLLBACK').run();
      throw error;
    }
    
  } catch (error) {
    console.error('Registration error:', error);
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// User login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Get user from database
    const user = userDb.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Generate token
    const token = generateToken(user);
    
    // Update last login
    userDb.updateLastLogin(user.id);
    
    res.json({
      success: true,
      user: { id: user.id, username: user.username },
      token
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user (protected route), plus which Beyond person they are.
router.get('/user', authenticateToken, (req, res) => {
  const person = personForUser(req.user);
  res.json({
    user: req.user,
    person: person ? { key: person.key, displayName: person.displayName } : null,
  });
});

// The team. Two people run the client side, so the velín needs to know who is
// who to attribute promises and calls.
router.get('/users', authenticateToken, (req, res) => {
  try {
    const rows = db
      .prepare('SELECT id, username, created_at, last_login FROM users WHERE is_active = 1 ORDER BY id')
      .all();
    res.json({
      users: rows.map((u) => {
        const person = personForUser(u);
        return {
          id: u.id,
          username: u.username,
          createdAt: u.created_at,
          lastLogin: u.last_login,
          person: person ? { key: person.key, displayName: person.displayName } : null,
          isMe: u.id === req.user.id,
        };
      }),
    });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a teammate. `/register` stays the unauthenticated first-run setup; every
// account after that is created from inside an existing session, so opening the
// app to a second person never opens registration to the internet.
router.post('/users', authenticateToken, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Vyplň jméno i heslo' });
    }
    if (username.length < 3 || password.length < 6) {
      return res
        .status(400)
        .json({ error: 'Jméno aspoň 3 znaky, heslo aspoň 6 znaků' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = userDb.createUser(username, passwordHash);
    const person = personForUser({ username });

    console.log(`[auth] ${req.user.username} přidal uživatele ${username}`);
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        person: person ? { key: person.key, displayName: person.displayName } : null,
      },
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Takové jméno už existuje' });
    }
    console.error('Add user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout (client-side token removal, but this endpoint can be used for logging)
router.post('/logout', authenticateToken, (req, res) => {
  // In a simple JWT system, logout is mainly client-side
  // This endpoint exists for consistency and potential future logging
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;

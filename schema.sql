-- Schema chat CRO Labs per MySQL / MariaDB (>= 10.5 / MySQL 8).
-- Eseguire una volta sul database indicato in MYSQL_DATABASE.

CREATE TABLE IF NOT EXISTS chat_conversations (
  id CHAR(36) NOT NULL PRIMARY KEY,
  public_id CHAR(36) NOT NULL UNIQUE,
  access_token_hash CHAR(64) NOT NULL,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(120) NOT NULL,
  status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conversation_id CHAR(36) NOT NULL,
  sender ENUM('visitor', 'operator') NOT NULL,
  body TEXT NOT NULL,
  telegram_message_id BIGINT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_chat_messages_conversation
    FOREIGN KEY (conversation_id) REFERENCES chat_conversations (id) ON DELETE CASCADE,
  CONSTRAINT chk_chat_messages_body CHECK (CHAR_LENGTH(body) BETWEEN 1 AND 2000),
  INDEX chat_messages_conversation_created_idx (conversation_id, created_at),
  INDEX chat_messages_telegram_id_idx (telegram_message_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

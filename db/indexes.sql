-- Built after the bulk load (faster than maintaining them row by row during COPY).
CREATE INDEX messages_tsv_idx    ON messages USING gin (tsv);
CREATE INDEX messages_conv_idx   ON messages (conversation_id);
CREATE INDEX messages_ts_idx     ON messages (ts);
CREATE INDEX messages_author_idx ON messages (author, conversation_id);  -- who says what: the author filter, voices
CREATE INDEX conv_tsv_idx        ON conversations USING gin (tsv);
CREATE INDEX conv_started_idx    ON conversations (started_at);
CREATE INDEX conv_topic_idx      ON conversations (topic, started_at);
CREATE INDEX conv_topics_idx     ON conversations USING gin (topics);   -- membership: $1 = ANY(topics)
CREATE INDEX conv_channel_idx    ON conversations (channel, started_at);
CREATE INDEX conv_embedding_idx  ON conversations USING hnsw (embedding vector_cosine_ops);
ANALYZE messages;
ANALYZE conversations;

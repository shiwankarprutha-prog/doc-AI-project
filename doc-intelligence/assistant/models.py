from django.db import models

class Document(models.Model):
    title = models.CharField(max_length=255)
    file = models.FileField(upload_to='documents/')
    file_type = models.CharField(max_length=10)
    text_content = models.TextField(blank=True)
    collection_id = models.CharField(max_length=100, unique=True)
    suggested_questions = models.JSONField(default=list)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title

class ChatSession(models.Model):
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name='chat_sessions')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Session for {self.document.title} ({self.created_at.strftime('%Y-%m-%d %H:%M')})"

class ChatMessage(models.Model):
    session = models.ForeignKey(ChatSession, on_delete=models.CASCADE, related_name='messages')
    question = models.TextField()
    answer = models.TextField()
    sources = models.JSONField(default=list)
    language_detected = models.CharField(max_length=50, default='en')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Q: {self.question[:40]}..."

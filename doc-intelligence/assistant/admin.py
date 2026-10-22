from django.contrib import admin
from .models import Document, ChatSession, ChatMessage

@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ('title', 'file_type', 'collection_id', 'uploaded_at')
    search_fields = ('title', 'collection_id')

@admin.register(ChatSession)
class ChatSessionAdmin(admin.ModelAdmin):
    list_display = ('id', 'document', 'created_at')
    search_fields = ('document__title',)

@admin.register(ChatMessage)
class ChatMessageAdmin(admin.ModelAdmin):
    list_display = ('id', 'session', 'question', 'language_detected', 'created_at')
    search_fields = ('question', 'answer')

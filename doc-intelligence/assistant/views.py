import json
import os
import uuid
from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from .models import Document, ChatSession, ChatMessage
from .rag_engine import (
    extract_text_from_pdf,
    extract_text_from_txt,
    chunk_text,
    embed_and_store,
    retrieve_chunks,
    generate_answer,
    generate_suggested_questions,
    extract_keywords,
    delete_collection,
    detect_language
)


def index(request):
    """Renders the home page with document upload and existing documents list."""
    try:
        documents = Document.objects.all().order_by('-uploaded_at')
        return render(request, 'index.html', {'documents': documents})
    except Exception as e:
        return render(request, 'index.html', {'documents': [], 'error': str(e)})


@csrf_exempt
def upload_document(request):
    """
    Handles PDF and TXT file uploads, extracts text, chunks it,
    creates ChromaDB collection with embeddings, generates suggested questions,
    and returns JSON with document ID.
    """
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'Invalid request method. POST required.'}, status=405)

    if 'file' not in request.FILES:
        return JsonResponse({'status': 'error', 'message': 'No file provided in upload.'}, status=400)

    try:
        uploaded_file = request.FILES['file']
        title = uploaded_file.name
        ext = os.path.splitext(title)[1].lower().replace('.', '')

        if ext not in ['pdf', 'txt']:
            return JsonResponse({'status': 'error', 'message': 'Unsupported file type. Only PDF and TXT allowed.'}, status=400)

        collection_id = f"doc_{uuid.uuid4().hex[:12]}"

        # Save document instance to disk and DB
        document = Document.objects.create(
            title=title,
            file=uploaded_file,
            file_type=ext,
            collection_id=collection_id
        )

        file_path = document.file.path

        # Extract text based on file type
        if ext == 'pdf':
            text = extract_text_from_pdf(file_path)
        else:
            text = extract_text_from_txt(file_path)

        document.text_content = text

        # Chunk text (~800 chars with 150 char overlap for richer context)
        chunks = chunk_text(text, chunk_size=800, overlap=150)

        # Store in ChromaDB with Gemini embeddings
        embed_and_store(collection_id, chunks)

        # Auto-suggest 5 questions via Gemini
        suggested = generate_suggested_questions(text, title)
        document.suggested_questions = suggested
        document.save()

        # Create default ChatSession for this document
        ChatSession.objects.create(document=document)

        return JsonResponse({
            'status': 'success',
            'doc_id': document.id,
            'title': document.title,
            'chunks_count': len(chunks),
            'suggested_questions': suggested
        })

    except Exception as e:
        return JsonResponse({'status': 'error', 'message': f"Error processing document: {str(e)}"}, status=500)


def chat_view(request, doc_id):
    """Renders the chat interface for a specific document."""
    try:
        document = get_object_or_404(Document, id=doc_id)
        session = ChatSession.objects.filter(document=document).order_by('-created_at').first()
        if not session:
            session = ChatSession.objects.create(document=document)

        return render(request, 'chat.html', {
            'document': document,
            'session': session
        })
    except Exception as e:
        return render(request, 'index.html', {'error': f"Failed to load document: {str(e)}"})


@csrf_exempt
def ask_question(request):
    """
    Handles AJAX question requests: retrieves chunks, generates answers via Gemini,
    saves ChatMessage to SQLite, and returns JSON.
    """
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'POST required'}, status=405)

    try:
        data = json.loads(request.body.decode('utf-8'))
        question = data.get('question', '').strip()
        doc_id = data.get('doc_id')

        if not question or not doc_id:
            return JsonResponse({'status': 'error', 'message': 'Question and doc_id are required.'}, status=400)

        document = get_object_or_404(Document, id=doc_id)
        session = ChatSession.objects.filter(document=document).order_by('-created_at').first()
        if not session:
            session = ChatSession.objects.create(document=document)

        # Retrieve relevant chunks from ChromaDB — use 6 chunks for richer context
        chunks = retrieve_chunks(document.collection_id, question, top_k=6)

        # Generate answer using Gemini generative model
        answer = generate_answer(question, chunks, document.title)

        # Prepare source chunks with highlighted keywords
        sources = []
        for chunk in chunks:
            kws = extract_keywords(chunk, top_n=6)
            sources.append({
                'text': chunk,
                'keywords': kws
            })

        # Detect language
        language = detect_language(question)

        # Save to ChatMessage
        ChatMessage.objects.create(
            session=session,
            question=question,
            answer=answer,
            sources=sources,
            language_detected=language
        )

        return JsonResponse({
            'status': 'success',
            'answer': answer,
            'sources': sources,
            'language': language
        })

    except Exception as e:
        return JsonResponse({'status': 'error', 'message': f"Error generating answer: {str(e)}"}, status=500)


def get_history(request, doc_id):
    """Returns past chat history for a document as JSON."""
    try:
        document = get_object_or_404(Document, id=doc_id)
        messages = ChatMessage.objects.filter(session__document=document).order_by('created_at')

        history = []
        for msg in messages:
            history.append({
                'id': msg.id,
                'question': msg.question,
                'answer': msg.answer,
                'sources': msg.sources,
                'language': msg.language_detected,
                'created_at': msg.created_at.strftime('%b %d, %Y %H:%M')
            })

        return JsonResponse({'status': 'success', 'history': history})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': f"Error retrieving history: {str(e)}"}, status=500)


@csrf_exempt
def delete_document(request, doc_id):
    """Deletes document, stored file, and associated ChromaDB collection."""
    if request.method != 'POST':
        return JsonResponse({'status': 'error', 'message': 'POST required'}, status=405)

    try:
        document = get_object_or_404(Document, id=doc_id)

        # Delete ChromaDB collection
        delete_collection(document.collection_id)

        # Delete file from filesystem if exists
        try:
            if document.file and os.path.exists(document.file.path):
                os.remove(document.file.path)
        except Exception as e:
            print(f"Warning: could not delete file from disk: {e}")

        # Delete Document record (cascades to Sessions and Messages)
        document.delete()

        return JsonResponse({'status': 'success', 'message': 'Document deleted successfully'})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': f"Error deleting document: {str(e)}"}, status=500)


def list_documents(request):
    """Returns JSON list of all documents."""
    try:
        documents = Document.objects.all().order_by('-uploaded_at')
        docs_data = []
        for doc in documents:
            docs_data.append({
                'id': doc.id,
                'title': doc.title,
                'file_type': doc.file_type.upper(),
                'uploaded_at': doc.uploaded_at.strftime('%b %d, %Y %H:%M'),
                'questions_count': len(doc.suggested_questions) if doc.suggested_questions else 0
            })
        return JsonResponse({'status': 'success', 'documents': docs_data})
    except Exception as e:
        return JsonResponse({'status': 'error', 'message': f"Error listing documents: {str(e)}"}, status=500)

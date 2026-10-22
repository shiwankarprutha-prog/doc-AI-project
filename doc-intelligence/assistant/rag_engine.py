import os
import re
import hashlib
from collections import Counter
from pathlib import Path
from django.conf import settings
from google import genai
from google.genai import types
import chromadb
import PyPDF2

# Try to import pdfminer for better PDF extraction (preserves spaces)
try:
    from pdfminer.high_level import extract_text as pdfminer_extract_text
    PDFMINER_AVAILABLE = True
except ImportError:
    PDFMINER_AVAILABLE = False

# Configure Gemini client
_client = None

def get_client():
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.GEMINI_API_KEY)
    return _client

# Model names — use full "models/" prefix as required by the API
# Ordered by preference: try each until one succeeds
GENERATION_MODELS = [
    "models/gemini-3.8-flash",
    "models/gemini-3.7-flash",
    "models/gemini-3.6-flash",
    "models/gemini-3.5-flash",
    "models/gemini-3.1-flash-lite",
    "models/gemini-3-flash-preview",
    "models/gemini-2.5-flash-lite",
    "models/gemini-flash-latest",
]

# Embedding model (full prefix)
EMBEDDING_MODEL = "models/text-embedding-004"

# Common stop words for keyword extraction
STOP_WORDS = {
    'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'in', 'on', 'at', 'to', 'for', 'with', 'by', 'about', 'against', 'between', 'into',
    'through', 'during', 'before', 'after', 'above', 'below', 'from', 'up', 'down',
    'out', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
    'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other',
    'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
    's', 't', 'can', 'will', 'just', 'don', 'should', 'now', 'this', 'that', 'these',
    'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'whom',
    'have', 'has', 'had', 'do', 'does', 'did', 'would', 'could', 'their', 'our', 'his', 'her'
}


def _fix_missing_spaces(text):
    """
    Post-processes extracted PDF text to fix common spacing issues:
    - Adds space before capital letters after lowercase letters (camelCase word merges)
    - Fixes words run together without spaces
    - Normalizes multiple spaces/newlines
    """
    if not text:
        return text

    # Fix common PDF extraction issue: lowercase followed immediately by uppercase
    # e.g. "documentTitle" → "document Title"
    text = re.sub(r'([a-z])([A-Z])', r'\1 \2', text)

    # Fix words merged with numbers: "section1.2" → "section 1.2"
    text = re.sub(r'([a-zA-Z])(\d)', r'\1 \2', text)
    text = re.sub(r'(\d)([a-zA-Z])', r'\1 \2', text)

    # Collapse multiple spaces into one
    text = re.sub(r'[ \t]+', ' ', text)

    # Normalize multiple blank lines
    text = re.sub(r'\n{3,}', '\n\n', text)

    # Ensure space after punctuation if followed by a letter
    text = re.sub(r'([.!?,:;])([A-Za-z])', r'\1 \2', text)

    return text.strip()


def extract_text_from_pdf(file_path):
    """Extracts all text content from a PDF file.
    
    Uses pdfminer.six first (better spacing), falls back to PyPDF2.
    Applies post-processing to fix missing spaces.
    """
    text = ""

    # Try pdfminer first — much better at preserving spaces
    if PDFMINER_AVAILABLE:
        try:
            text = pdfminer_extract_text(str(file_path))
            if text and len(text.strip()) > 50:
                return _fix_missing_spaces(text)
        except Exception as e:
            print(f"pdfminer extraction failed, trying PyPDF2: {e}")

    # Fallback to PyPDF2
    try:
        reader = PyPDF2.PdfReader(file_path)
        for page in reader.pages:
            extracted = page.extract_text()
            if extracted:
                text += extracted + "\n"
    except Exception as e:
        print(f"Error reading PDF {file_path}: {e}")

    return _fix_missing_spaces(text)


def extract_text_from_txt(file_path):
    """Extracts text content from a TXT file."""
    for encoding in ['utf-8', 'latin-1', 'cp1252']:
        try:
            with open(file_path, 'r', encoding=encoding) as f:
                return f.read().strip()
        except UnicodeDecodeError:
            continue
        except Exception as e:
            print(f"Error reading TXT {file_path}: {e}")
            break
    return ""


def chunk_text(text, chunk_size=500, overlap=100):
    """
    Splits text into overlapping chunks of approx chunk_size characters
    with overlap characters between consecutive chunks.
    """
    if not text:
        return []

    chunks = []
    step = chunk_size - overlap
    if step <= 0:
        step = chunk_size

    start = 0
    text_length = len(text)

    while start < text_length:
        end = start + chunk_size
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start += step

    return chunks


def get_or_create_collection(collection_id):
    """Creates a ChromaDB persistent client at ./chroma_db and returns the collection."""
    db_path = str(Path(settings.BASE_DIR) / 'chroma_db')
    os.makedirs(db_path, exist_ok=True)
    client = chromadb.PersistentClient(path=db_path)
    return client.get_or_create_collection(name=collection_id)


def delete_collection(collection_id):
    """Deletes a ChromaDB collection by collection_id."""
    try:
        db_path = str(Path(settings.BASE_DIR) / 'chroma_db')
        client = chromadb.PersistentClient(path=db_path)
        client.delete_collection(name=collection_id)
        return True
    except Exception as e:
        print(f"Error deleting collection {collection_id}: {e}")
        return False


def _fallback_pseudo_embedding(text, dim=768):
    """Deterministic fallback vector representation if API is unavailable."""
    h = hashlib.sha256(text.encode('utf-8')).hexdigest()
    vec = []
    for i in range(dim):
        idx = (i * 2) % (len(h) - 1)
        b = int(h[idx:idx + 2], 16)
        vec.append((b - 128.0) / 128.0)
    return vec


def _get_embedding(content, task_type="RETRIEVAL_DOCUMENT"):
    """Fetches embedding for a given text using Gemini embedding model with fallback."""
    # Try with full prefix first, then short name
    for model_name in ["models/text-embedding-004", "models/gemini-embedding-001", "text-embedding-004"]:
        try:
            client = get_client()
            result = client.models.embed_content(
                model=model_name,
                contents=content,
                config=types.EmbedContentConfig(task_type=task_type)
            )
            emb = result.embeddings[0].values
            if emb:
                return list(emb)
        except Exception as e:
            print(f"Embedding error with {model_name}: {e}")
    return _fallback_pseudo_embedding(content, 768)


def embed_and_store(collection_id, chunks):
    """
    Gets embeddings from Gemini for each chunk and stores them in ChromaDB.
    """
    if not chunks:
        return 0

    collection = get_or_create_collection(collection_id)
    embeddings = []
    documents = []
    ids = []

    for i, chunk in enumerate(chunks):
        if not chunk.strip():
            continue
        try:
            emb = _get_embedding(chunk, task_type="RETRIEVAL_DOCUMENT")
            embeddings.append(emb)
            documents.append(chunk)
            ids.append(f"{collection_id}_{i}")
        except Exception as e:
            print(f"Failed to embed chunk {i}: {e}")

    if documents:
        batch_size = 50
        for b_start in range(0, len(documents), batch_size):
            b_end = b_start + batch_size
            collection.add(
                ids=ids[b_start:b_end],
                embeddings=embeddings[b_start:b_end],
                documents=documents[b_start:b_end]
            )

    return len(documents)


def retrieve_chunks(collection_id, query, top_k=4):
    """
    Embeds the query and queries ChromaDB collection to return top_k results.
    """
    try:
        collection = get_or_create_collection(collection_id)
        total_count = collection.count()
        if total_count == 0:
            return []

        actual_k = min(top_k, total_count)
        query_emb = _get_embedding(query, task_type="RETRIEVAL_QUERY")
        results = collection.query(
            query_embeddings=[query_emb],
            n_results=actual_k
        )

        doc_lists = results.get('documents', [])
        if doc_lists and len(doc_lists) > 0:
            return doc_lists[0]
        return []
    except Exception as e:
        print(f"Error retrieving chunks for query '{query}': {e}")
        return []


def generate_answer(question, chunks, doc_title):
    """
    Generates a detailed, grammatically correct, well-structured answer
    based on document excerpts using Gemini generative model.
    Cascades through available models if one is busy/unavailable.
    """
    if chunks:
        numbered_chunks = "\n\n".join(
            f"[Excerpt {i+1}]:\n{chunk}" for i, chunk in enumerate(chunks)
        )
    else:
        numbered_chunks = "No relevant document excerpts were found in this document."

    prompt = f"""You are an expert document analysis assistant. Your job is to answer user questions based strictly on the provided document excerpts from the document titled: "{doc_title}".

STRICT RULES you MUST follow:
1. Answer ONLY based on the information present in the document excerpts below.
2. If the question cannot be answered from the excerpts, respond with: "I could not find sufficient information about this topic in the document '{doc_title}'. The document may not cover this subject, or the relevant section may not have been retrieved."
3. Write your answer in clear, grammatically correct, well-structured English (or match the user's question language if non-English).
4. Be THOROUGH and DETAILED — elaborate fully on every point found in the excerpts.
5. Use proper paragraph structure. Where appropriate, use bullet points or numbered lists to organize information clearly.
6. Do NOT make up information. Do NOT use prior knowledge outside the document excerpts.
7. If the excerpts contain partial information, mention what is available and note any limitations.
8. Start directly with the answer — do NOT say "Based on the document..." or "According to the excerpts..." as an opener.

USER QUESTION:
{question}

DOCUMENT EXCERPTS FROM "{doc_title}":
{numbered_chunks}

DETAILED ANSWER:"""

    last_error = None
    client = get_client()

    for model_name in GENERATION_MODELS:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.3,
                    max_output_tokens=2048,
                    top_p=0.9,
                )
            )
            if response and response.text and response.text.strip():
                print(f"[RAG] Answer generated using: {model_name}")
                return response.text.strip()
        except Exception as e:
            last_error = e
            err_str = str(e)
            # Skip immediately on quota/rate-limit, try next model
            if "429" in err_str or "503" in err_str or "404" in err_str:
                print(f"[RAG] Model {model_name} unavailable ({err_str[:60]}), trying next...")
                continue
            print(f"[RAG] Generation error with {model_name}: {e}")
            continue

    print(f"[RAG] All models failed. Last error: {last_error}")
    # If all models fail, return a graceful message
    if chunks:
        return (
            f"I was able to retrieve relevant excerpts from **{doc_title}**, but the AI service is temporarily unavailable. "
            f"Here is the most relevant section found:\n\n> {chunks[0][:600]}"
        )
    return f"I could not find sufficient information about this topic in the document '{doc_title}'."


def generate_suggested_questions(text_sample, doc_title):
    """
    Sends first 2000 chars of text to Gemini and asks for 5 questions a user might ask.
    Returns a Python list of 5 question strings.
    """
    sample = text_sample[:2000] if text_sample else ""
    prompt = (
        f"Based on the following document excerpt from '{doc_title}', suggest exactly 5 interesting and relevant questions "
        f"that a user might ask about this document.\n"
        f"Return ONLY the 5 questions, one per line. Do not number them or add any other text.\n\n"
        f"Excerpt:\n{sample}"
    )

    client = get_client()
    for model_name in GENERATION_MODELS:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt
            )
            if response and response.text:
                lines = [
                    re.sub(r'^[0-9]+[\.\)\-]\s*', '', line.strip()).strip()
                    for line in response.text.strip().split('\n')
                    if line.strip()
                ]
                questions = [q for q in lines if len(q) > 5][:5]
                if len(questions) >= 3:
                    return questions
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "503" in err_str or "404" in err_str:
                continue
            print(f"Suggested questions error with {model_name}: {e}")

    return [
        f"What is the main topic of {doc_title}?",
        "Can you summarize the key findings or sections?",
        "What are the most important conclusions mentioned?",
        "Who or what are the primary subjects discussed?",
        "What recommendations or next steps are outlined?"
    ]


def extract_keywords(text, top_n=8):
    """
    Extracts important keywords from text using frequency-based approach,
    ignoring stop words and short tokens.
    """
    if not text:
        return []

    words = re.findall(r'\b[a-zA-Z]{3,}\b', text.lower())
    filtered = [w for w in words if w not in STOP_WORDS]
    counts = Counter(filtered)
    return [word for word, _ in counts.most_common(top_n)]


def detect_language(text):
    """
    Simple heuristic language detection for common scripts, default to 'en'.
    """
    if not text:
        return 'en'

    if re.search(r'[\u0900-\u097F]', text):
        return 'hi'   # Hindi / Devanagari
    if re.search(r'[\u4E00-\u9FFF]', text):
        return 'zh'   # Chinese
    if re.search(r'[\u3040-\u30FF]', text):
        return 'ja'   # Japanese
    if re.search(r'[\u0600-\u06FF]', text):
        return 'ar'   # Arabic
    if re.search(r'[\u0400-\u04FF]', text):
        return 'ru'   # Russian
    if re.search(r'[¿¡áéíóúüñÁÉÍÓÚÜÑ]', text):
        return 'es'   # Spanish
    if re.search(r'[àâçéèêëîïôûùüÿœæ]', text, re.IGNORECASE):
        return 'fr'   # French
    if re.search(r'[äöüß]', text, re.IGNORECASE):
        return 'de'   # German

    return 'en'

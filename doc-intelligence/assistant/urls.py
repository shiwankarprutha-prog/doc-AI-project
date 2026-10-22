from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('upload/', views.upload_document, name='upload'),
    path('chat/<int:doc_id>/', views.chat_view, name='chat'),
    path('ask/', views.ask_question, name='ask'),
    path('history/<int:doc_id>/', views.get_history, name='history'),
    path('delete/<int:doc_id>/', views.delete_document, name='delete'),
    path('documents/', views.list_documents, name='documents'),
]

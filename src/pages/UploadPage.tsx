import { useState, useEffect, useRef, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import {
  ChefHat,
  LogOut,
  Upload,
  ImagePlus,
  CheckCircle2,
  X,
  Loader2,
  Crown,
  Camera,
  Sparkles,
  Mail,
  ArrowRight,
} from 'lucide-react';

const MAX_UPLOADS = 5;
const PENDING_UPLOAD_STORAGE_KEY = 'foodsnap-pending-upload';

interface UploadRecord {
  id: string;
  file_name: string;
  uploaded_at: string;
}

interface SelectedUpload {
  id: string;
  file: File;
  preview: string;
}

interface PendingUploadFilePayload {
  fileName: string;
  fileType: string;
  fileDataUrl: string;
}

interface PendingUploadPayload {
  files: PendingUploadFilePayload[];
  recipientEmail: string;
  showEmailStep: boolean;
}

function dataUrlToFile(dataUrl: string, fileName: string, fileType: string) {
  const [header, base64Data] = dataUrl.split(',');
  if (!header || !base64Data) {
    throw new Error('Invalid saved upload data.');
  }

  const mimeMatch = header.match(/data:(.*?);base64/);
  const mimeType = fileType || mimeMatch?.[1] || 'application/octet-stream';
  const binary = window.atob(base64Data);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new File([bytes], fileName, { type: mimeType });
}

function createSelectedUpload(file: File, suffix: string) {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${suffix}`,
    file,
    preview: URL.createObjectURL(file),
  };
}

export default function UploadPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [loadingUploads, setLoadingUploads] = useState(true);
  const [selectedUploads, setSelectedUploads] = useState<SelectedUpload[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [showEmailStep, setShowEmailStep] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [sendingMagicLink, setSendingMagicLink] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const verifiedEmail = session?.user.email ?? '';
  const uploadCount = uploads.length;
  const remainingUploads = Math.max(MAX_UPLOADS - uploadCount, 0);
  const queuedUploadCount = selectedUploads.length;
  const limitReached = remainingUploads === 0;

  const clearPendingUpload = useCallback(() => {
    window.sessionStorage.removeItem(PENDING_UPLOAD_STORAGE_KEY);
  }, []);

  const updatePendingUploadMetadata = useCallback(
    (nextRecipientEmail: string, nextShowEmailStep: boolean) => {
      const savedUpload = window.sessionStorage.getItem(PENDING_UPLOAD_STORAGE_KEY);
      if (!savedUpload) {
        return;
      }

      try {
        const payload = JSON.parse(savedUpload) as PendingUploadPayload;
        const nextPayload: PendingUploadPayload = {
          ...payload,
          recipientEmail: nextRecipientEmail,
          showEmailStep: nextShowEmailStep,
        };
        window.sessionStorage.setItem(PENDING_UPLOAD_STORAGE_KEY, JSON.stringify(nextPayload));
      } catch {
        clearPendingUpload();
      }
    },
    [clearPendingUpload]
  );

  const persistPendingUpload = useCallback(
    async (files: File[], nextRecipientEmail: string, nextShowEmailStep: boolean) => {
      const serializedFiles = await Promise.all(
        files.map(
          (file) =>
            new Promise<PendingUploadFilePayload>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({
                  fileName: file.name,
                  fileType: file.type,
                  fileDataUrl: String(reader.result),
                });
              reader.onerror = () => reject(new Error('Failed to save the selected photos.'));
              reader.readAsDataURL(file);
            })
        )
      );

      const payload: PendingUploadPayload = {
        files: serializedFiles,
        recipientEmail: nextRecipientEmail,
        showEmailStep: nextShowEmailStep,
      };

      window.sessionStorage.setItem(PENDING_UPLOAD_STORAGE_KEY, JSON.stringify(payload));
    },
    []
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      if (currentSession?.user.email) {
        setRecipientEmail(currentSession.user.email);
      }
      setAuthLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      if (currentSession?.user.email) {
        setRecipientEmail(currentSession.user.email);
        setSuccessMsg(`Email verified for ${currentSession.user.email}. You can finish submission now.`);
        setError('');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    return () => {
      selectedUploads.forEach((upload) => URL.revokeObjectURL(upload.preview));
    };
    // We revoke previews explicitly when files are removed and once on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const savedUpload = window.sessionStorage.getItem(PENDING_UPLOAD_STORAGE_KEY);
    if (!savedUpload) {
      return;
    }

    try {
      const payload = JSON.parse(savedUpload) as PendingUploadPayload;
      const restoredUploads = payload.files.map((pendingFile, index) => {
        const restoredFile = dataUrlToFile(
          pendingFile.fileDataUrl,
          pendingFile.fileName,
          pendingFile.fileType
        );

        return createSelectedUpload(restoredFile, `restored-${index}`);
      });

      setSelectedUploads(restoredUploads);
      setRecipientEmail((currentEmail) => currentEmail || payload.recipientEmail);
      setShowEmailStep(payload.showEmailStep);
    } catch {
      clearPendingUpload();
    }
  }, [clearPendingUpload]);

  const fetchUploads = useCallback(async () => {
    if (!session?.user.id) {
      setUploads([]);
      setLoadingUploads(false);
      return;
    }

    setLoadingUploads(true);
    const { data, error: fetchError } = await supabase
      .from('user_uploads')
      .select('id, file_name, uploaded_at')
      .order('uploaded_at', { ascending: false });

    if (!fetchError && data) {
      setUploads(data);
    }

    setLoadingUploads(false);
  }, [session?.user.id]);

  useEffect(() => {
    if (!authLoading) {
      fetchUploads();
    }
  }, [authLoading, fetchUploads]);

  function isVerifiedForRecipient() {
    return Boolean(
      session?.user.email &&
      recipientEmail &&
      session.user.email.toLowerCase() === recipientEmail.trim().toLowerCase()
    );
  }

  async function handleSendMagicLink() {
    const email = recipientEmail.trim();
    if (!email) {
      setError('Please enter the email that should receive the upgraded photo.');
      return;
    }

    updatePendingUploadMetadata(email, true);

    setSendingMagicLink(true);
    setError('');
    setSuccessMsg('');

    try {
      if (session?.user.email && session.user.email.toLowerCase() !== email.toLowerCase()) {
        await supabase.auth.signOut();
        setSession(null);
        setUploads([]);
      }

      const { error: signInError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: window.location.origin,
        },
      });

      if (signInError) {
        throw signInError;
      }

      setSuccessMsg(`Magic link sent to ${email}. Open your email and click the link to verify.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send magic link.');
    } finally {
      setSendingMagicLink(false);
    }
  }

  async function syncPendingUploads(nextSelectedUploads: SelectedUpload[]) {
    if (nextSelectedUploads.length === 0) {
      clearPendingUpload();
      return;
    }

    await persistPendingUpload(
      nextSelectedUploads.map((upload) => upload.file),
      recipientEmail.trim(),
      showEmailStep
    );
  }

  async function handleFileSelect(fileList: FileList | File[]) {
    const incomingFiles = Array.from(fileList);
    if (incomingFiles.length === 0) {
      return;
    }

    const availableSlots = MAX_UPLOADS - uploadCount - selectedUploads.length;
    if (availableSlots <= 0) {
      setError(`You can upload up to ${MAX_UPLOADS} photos.`);
      return;
    }

    const validFiles: File[] = [];

    for (const file of incomingFiles) {
      if (!file.type.startsWith('image/')) {
        setError('Please select only image files (JPEG, PNG, WebP, GIF).');
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        setError(`"${file.name}" is over the 10 MB limit.`);
        return;
      }

      validFiles.push(file);
    }

    const filesToAdd = validFiles.slice(0, availableSlots);
    if (filesToAdd.length === 0) {
      setError(`You can upload up to ${MAX_UPLOADS} photos.`);
      return;
    }

    const nextSelectedUploads = [
      ...selectedUploads,
      ...filesToAdd.map((file, index) => createSelectedUpload(file, `${Date.now()}-${index}`)),
    ];

    setError(
      validFiles.length > availableSlots
        ? `Only ${availableSlots} more photo${availableSlots === 1 ? '' : 's'} can be added.`
        : ''
    );
    setSuccessMsg('');
    setSelectedUploads(nextSelectedUploads);

    try {
      await syncPendingUploads(nextSelectedUploads);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the selected photos.');
    }
  }

  async function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) {
      await handleFileSelect(e.target.files);
    }
    e.target.value = '';
  }

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files?.length) {
        await handleFileSelect(e.dataTransfer.files);
      }
    },
    [handleFileSelect]
  );

  function clearSelection() {
    selectedUploads.forEach((upload) => URL.revokeObjectURL(upload.preview));
    setSelectedUploads([]);
    setError('');
    clearPendingUpload();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function removeSelectedUpload(id: string) {
    const uploadToRemove = selectedUploads.find((upload) => upload.id === id);
    if (!uploadToRemove) {
      return;
    }

    URL.revokeObjectURL(uploadToRemove.preview);
    const nextSelectedUploads = selectedUploads.filter((upload) => upload.id !== id);
    setSelectedUploads(nextSelectedUploads);
    setError('');
    setSuccessMsg('');

    try {
      await syncPendingUploads(nextSelectedUploads);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update the selected photos.');
    }
  }

  async function uploadVerifiedPhoto() {
    if (selectedUploads.length === 0 || limitReached) {
      return;
    }

    const {
      data: { session: currentSession },
    } = await supabase.auth.getSession();
    const userId = currentSession?.user.id;
    const currentEmail = currentSession?.user.email ?? '';

    if (!userId || currentEmail.toLowerCase() !== recipientEmail.trim().toLowerCase()) {
      throw new Error('Please verify your email with the magic link before uploading.');
    }

    const token = currentSession?.access_token;
    if (!token) {
      throw new Error('Email verification is required before upload.');
    }

    for (const [index, selectedUpload] of selectedUploads.entries()) {
      const timestamp = Date.now() + index;
      const safeName = selectedUpload.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `${userId}/${timestamp}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from('food-photos')
        .upload(filePath, selectedUpload.file, { upsert: false });

      if (uploadError) {
        throw uploadError;
      }

      const { data: fnData, error: fnError } = await supabase.functions.invoke('notify-upload', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: {
          filePath,
          fileName: selectedUpload.file.name,
          userEmail: recipientEmail.trim(),
        },
      });

      if (fnError) {
        throw new Error(fnError.message || 'Upload notification failed');
      }

      if (fnData && typeof fnData === 'object' && 'error' in fnData && fnData.error) {
        throw new Error(String(fnData.error));
      }
    }

    setSuccessMsg(
      `${selectedUploads.length} photo${selectedUploads.length === 1 ? '' : 's'} submitted. We'll deliver the upgraded image${selectedUploads.length === 1 ? '' : 's'} to ${recipientEmail.trim()}.`
    );
    clearSelection();
    setShowEmailStep(false);
    await fetchUploads();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedUploads.length === 0 || limitReached) {
      return;
    }

    if (!showEmailStep) {
      const nextRecipientEmail = session?.user.email ?? recipientEmail;
      setRecipientEmail(nextRecipientEmail);
      setShowEmailStep(true);
      setError('');
      setSuccessMsg('');
      await persistPendingUpload(
        selectedUploads.map((upload) => upload.file),
        nextRecipientEmail.trim(),
        true
      );
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccessMsg('');

    try {
      if (!isVerifiedForRecipient()) {
        throw new Error('Verify your email with the magic link before uploading.');
      }

      await uploadVerifiedPhoto();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setSession(null);
    setUploads([]);
    selectedUploads.forEach((upload) => URL.revokeObjectURL(upload.preview));
    setSelectedUploads([]);
    setSuccessMsg('');
    setError('');
    setShowEmailStep(false);
    clearPendingUpload();
  }

  return (
    <div className="min-h-screen bg-[#FDF8F0]">
      <header className="bg-white border-b border-[#F0E4D4] sticky top-0 z-20 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#E85D26] flex items-center justify-center">
              <ChefHat className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-[#2C1810] text-lg tracking-tight">FoodSnap</span>
          </div>
          <div className="flex items-center gap-3">
            {verifiedEmail ? (
              <>
                <span className="text-sm text-[#6B4226] hidden sm:block truncate max-w-[220px]">
                  Verified: {verifiedEmail}
                </span>
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-1.5 text-sm text-[#9B6645] hover:text-[#E85D26] transition font-medium"
                >
                  <LogOut className="w-4 h-4" />
                  <span className="hidden sm:inline">Change email</span>
                </button>
              </>
            ) : (
              <span className="text-sm text-[#9B6645] hidden sm:block">No login required</span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 bg-[#FFF0E6] border border-[#F4C6A8] text-[#E85D26] text-sm font-medium px-3 py-1 rounded-full mb-2">
            <Sparkles className="w-4 h-4" />
            AI Food Photo Enhancement
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-[#2C1810] leading-tight">
            Upload Your Food Photos
          </h1>
          <p className="text-[#9B6645] max-w-lg mx-auto">
            Submit your dish photos and our AI will transform them into stunning, professional-grade
            food photography.
          </p>
        </div>

        {!loadingUploads && limitReached && (
          <div className="bg-gradient-to-br from-[#2C1810] to-[#6B2F10] rounded-2xl p-8 text-center shadow-xl">
            <div className="w-14 h-14 rounded-2xl bg-yellow-400/20 flex items-center justify-center mx-auto mb-4">
              <Crown className="w-8 h-8 text-yellow-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Unlock Unlimited Submissions</h2>
            <p className="text-white/70 max-w-md mx-auto mb-6">
              You&apos;ve used all {MAX_UPLOADS} free photo submissions. Upgrade to Pro for unlimited
              AI enhancements, priority processing, and premium filters.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button className="bg-yellow-400 hover:bg-yellow-300 text-[#2C1810] font-bold px-6 py-3 rounded-xl flex items-center justify-center gap-2 transition shadow-lg shadow-yellow-400/20">
                <Crown className="w-5 h-5" />
                Upgrade to Pro - $9/mo
              </button>
              <button className="border border-white/20 text-white hover:bg-white/10 px-6 py-3 rounded-xl transition font-medium">
                View Plans
              </button>
            </div>
          </div>
        )}

        {!loadingUploads && !limitReached && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {selectedUploads.length === 0 ? (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`
                  relative border-2 border-dashed rounded-2xl p-10 text-center transition-all duration-200
                  cursor-pointer
                  ${
                    isDragging
                      ? 'border-[#E85D26] bg-[#FFF0E6] scale-[1.01]'
                      : 'border-[#D4B896] bg-white hover:border-[#E85D26] hover:bg-[#FFF8F3]'
                  }
                `}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={handleInputChange}
                />
                <div className="flex flex-col items-center gap-4 pointer-events-none">
                  <div className="w-16 h-16 rounded-2xl bg-[#FFF0E6] border-2 border-[#F4C6A8] flex items-center justify-center">
                    <ImagePlus className="w-8 h-8 text-[#E85D26]" />
                  </div>
                  <div>
                    <p className="font-semibold text-[#2C1810] text-lg">
                      {isDragging ? 'Drop your photos here' : 'Click or drag photos here'}
                    </p>
                    <p className="text-[#9B6645] text-sm mt-1">
                      JPEG, PNG, WebP, GIF • Up to {remainingUploads} photo
                      {remainingUploads === 1 ? '' : 's'} • Max 10 MB each
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {selectedUploads.map((upload) => (
                    <div
                      key={upload.id}
                      className="relative bg-white rounded-2xl border border-[#F0E4D4] overflow-hidden shadow-sm"
                    >
                      <div className="relative">
                        <img
                          src={upload.preview}
                          alt={upload.file.name}
                          className="w-full h-48 object-cover bg-[#F9F3EB]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void removeSelectedUpload(upload.id);
                          }}
                          className="absolute top-3 right-3 w-8 h-8 bg-black/50 hover:bg-black/70 text-white rounded-full flex items-center justify-center transition"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="p-4 flex items-center gap-3">
                        <ImagePlus className="w-5 h-5 text-[#E85D26] shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#2C1810] truncate">
                            {upload.file.name}
                          </p>
                          <p className="text-xs text-[#9B6645]">
                            {(upload.file.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-white rounded-2xl border border-[#F0E4D4] p-4 flex flex-col sm:flex-row sm:items-center gap-3 shadow-sm">
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#2C1810]">
                      {queuedUploadCount} photo{queuedUploadCount === 1 ? '' : 's'} ready to submit
                    </p>
                    <p className="text-xs text-[#9B6645] mt-1">
                      You can still add {Math.max(remainingUploads - queuedUploadCount, 0)} more
                      photo{Math.max(remainingUploads - queuedUploadCount, 0) === 1 ? '' : 's'}.
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={queuedUploadCount >= remainingUploads}
                      className="text-sm text-[#E85D26] hover:underline font-medium shrink-0 disabled:opacity-50 disabled:no-underline"
                    >
                      Add more
                    </button>
                    <button
                      type="button"
                      onClick={clearSelection}
                      className="text-sm text-[#9B6645] hover:text-[#E85D26] font-medium shrink-0"
                    >
                      Clear all
                    </button>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={handleInputChange}
                  />
                </div>
              </div>
            )}

            {showEmailStep && (
              <div className="bg-white rounded-2xl border border-[#F0E4D4] p-6 shadow-sm space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-[#2C1810]">
                    Where should we send the upgraded photo{queuedUploadCount === 1 ? '' : 's'}?
                  </h2>
                  <p className="text-sm text-[#9B6645] mt-1">
                    We&apos;ll verify this email with a magic link before finishing the submission.
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="block text-sm font-medium text-[#6B4226]">Delivery email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#C8A882]" />
                    <input
                      type="email"
                      required
                      value={recipientEmail}
                      onChange={(e) => {
                        const nextEmail = e.target.value;
                        setRecipientEmail(nextEmail);
                        updatePendingUploadMetadata(nextEmail.trim(), showEmailStep);
                        setSuccessMsg('');
                        setError('');
                      }}
                      placeholder="you@example.com"
                      className="w-full rounded-xl border border-[#E7D4BF] bg-[#FFFDF9] pl-11 pr-4 py-3 text-[#2C1810] placeholder-[#C8A882] focus:outline-none focus:ring-2 focus:ring-[#E85D26] focus:border-transparent transition"
                    />
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      type="button"
                      onClick={handleSendMagicLink}
                      disabled={sendingMagicLink || authLoading}
                      className="sm:w-auto w-full bg-[#E85D26] hover:bg-[#CF4F1F] disabled:opacity-50 text-white font-semibold py-3 px-5 rounded-xl flex items-center justify-center gap-2 transition"
                    >
                      {sendingMagicLink ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Sending link...
                        </>
                      ) : (
                        <>
                          Send Magic Link <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>

                    {isVerifiedForRecipient() ? (
                      <div className="inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-1 text-sm text-green-700 border border-green-200 self-center">
                        <CheckCircle2 className="w-4 h-4" />
                        Email verified
                      </div>
                    ) : (
                      <div className="text-sm text-[#9B6645] self-center">
                        Click the link from your email, then submit once more to finish.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex items-start gap-2">
                <X className="w-4 h-4 mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            {successMsg && (
              <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {successMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={selectedUploads.length === 0 || submitting || authLoading}
              className="w-full bg-[#E85D26] hover:bg-[#CF4F1F] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 transition-all duration-200 shadow-lg hover:shadow-[#E85D26]/30 text-base"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Submitting photo{queuedUploadCount === 1 ? '' : 's'}...
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5" />
                  {showEmailStep
                    ? `Finish Submission${queuedUploadCount > 1 ? ` (${queuedUploadCount} photos)` : ''}`
                    : `Submit Photo${queuedUploadCount === 1 ? '' : 's'}`}
                  {uploadCount > 0 && (
                    <span className="ml-1 text-white/70 text-sm font-normal">
                      ({remainingUploads} left)
                    </span>
                  )}
                </>
              )}
            </button>
          </form>
        )}

        <div className="bg-white border border-[#F0E4D4] rounded-2xl p-5 flex gap-4 items-start shadow-sm">
          <div className="w-10 h-10 rounded-xl bg-[#FFF0E6] flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-[#E85D26]" />
          </div>
          <div>
            <h3 className="font-semibold text-[#2C1810] text-sm">How it works</h3>
            <p className="text-[#9B6645] text-sm mt-1 leading-relaxed">
              Upload your food photos first. When you submit them, we&apos;ll ask where to send the
              upgraded versions and verify that email with a magic link before finishing the
              submission.
            </p>
          </div>
        </div>

        {!loadingUploads && uploads.length > 0 && (
          <div className="bg-white rounded-2xl border border-[#F0E4D4] p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-[#E85D26]" />
                <span className="font-semibold text-[#2C1810]">Photo Submissions</span>
              </div>
              <span className="text-sm font-medium text-[#6B4226]">
                {uploadCount} / {MAX_UPLOADS} used
              </span>
            </div>
            <div className="w-full bg-[#F0E4D4] rounded-full h-2.5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min((uploadCount / MAX_UPLOADS) * 100, 100)}%`,
                  background:
                    limitReached ? '#DC2626' : uploadCount === 2 ? '#D97706' : '#E85D26',
                }}
              />
            </div>
            <ul className="mt-4 space-y-2">
              {uploads.map((u, i) => (
                <li key={u.id} className="flex items-center gap-3 text-sm text-[#6B4226]">
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  <span className="truncate flex-1">{u.file_name}</span>
                  <span className="text-[#C8A882] shrink-0">
                    Photo {i + 1} •{' '}
                    {new Date(u.uploaded_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}

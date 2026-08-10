import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);
export const supabase = supabaseConfigured ? createClient(url, anonKey) : null;

const reactionVoterStorageKey = "place-reaction-voter-token";
const requirePlaceId = (id) => {
  if (typeof id !== "string" || !id.trim())
    throw new Error("地点 ID 无效，请刷新后台后重试");
  return id;
};

function getReactionVoterToken() {
  let token = window.localStorage.getItem(reactionVoterStorageKey);
  if (!token) {
    token = crypto.randomUUID();
    window.localStorage.setItem(reactionVoterStorageKey, token);
  }
  return token;
}

export async function loadPlaceReactions(placeId) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("get_place_reactions", {
    target_place_id: placeId,
    voter_token: getReactionVoterToken(),
  });
  if (error) throw error;
  return data || [];
}

export async function setPlaceReaction(placeId, reaction) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase.rpc("set_place_reaction", {
    target_place_id: placeId,
    new_reaction: reaction,
    voter_token: getReactionVoterToken(),
  });
  if (error) throw error;
  return data || [];
}

export async function compressImageToWebp(
  file,
  maxDimension = 1600,
  quality = 0.82,
) {
  if (
    !file?.type?.startsWith("image/") ||
    file.type === "image/gif" ||
    typeof createImageBitmap !== "function"
  )
    return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(
      1,
      maxDimension / Math.max(bitmap.width, bitmap.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas
      .getContext("2d")
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    bitmap.close();
    if (!blob || blob.size >= file.size) return file;
    const basename = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${basename}.webp`, {
      type: "image/webp",
      lastModified: Date.now(),
    });
  } catch {
    bitmap?.close?.();
    return file;
  }
}

export async function loadDynamicCatalog() {
  if (!supabase) return null;
  const [categoriesResult, fieldsResult, placesResult, reactionsResult] =
    await Promise.all([
    supabase
      .from("categories")
      .select("id,label,color,sort_order")
      .order("sort_order"),
    supabase
      .from("detail_fields")
      .select("key,label,default_value,sort_order")
      .order("sort_order"),
    supabase
      .from("places")
      .select(
        "id,name,recommendation,category_id,latitude,longitude,address,hours,price,best_for,rating,cover_url,image_urls,tags,highlights,custom_details",
      )
      .eq("status", "approved")
      .order("submitted_at", { ascending: false }),
    supabase
      .from("reaction_definitions")
      .select("value,emoji,label,sort_order")
      .order("sort_order"),
  ]);
  const error =
    categoriesResult.error ||
    fieldsResult.error ||
    placesResult.error ||
    reactionsResult.error;
  if (error) throw error;
  const placeIds = (placesResult.data || []).map((place) => place.id);
  const { data: reactionSummaries, error: reactionSummariesError } =
    placeIds.length
      ? await supabase.rpc("get_place_reaction_summaries", {
          target_place_ids: placeIds,
        })
      : { data: [], error: null };
  if (reactionSummariesError) throw reactionSummariesError;
  return {
    categories: categoriesResult.data,
    detailFields: fieldsResult.data,
    places: placesResult.data,
    reactions: reactionsResult.data,
    reactionSummaries: reactionSummaries || [],
  };
}

export function mapDynamicPlace(row, categoriesById, detailFields) {
  const category = categoriesById[row.category_id];
  const details = detailFields.map((field) => ({
    key: field.key,
    label: field.label,
    value:
      row[field.key] ||
      row[
        field.key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
      ] ||
      row.custom_details?.[field.key] ||
      field.default_value ||
      "",
  }));
  const images = row.image_urls?.length
    ? row.image_urls
    : row.cover_url
      ? [row.cover_url]
      : [];
  return {
    id: row.id,
    name: row.name,
    recommendation: row.recommendation,
    category: row.category_id,
    categoryLabel: category?.label || row.category_id || "",
    color: category?.color,
    coordinates: [row.longitude, row.latitude],
    address: row.address || "",
    rating: row.rating ?? "—",
    cover: row.cover_url || images[0] || "",
    images,
    tags: row.tags || [],
    highlights: row.highlights || [],
    details,
  };
}

export async function submitPlace(
  payload,
  turnstileToken,
  submissionId = null,
) {
  if (!supabase) throw new Error("Supabase 未配置");
  let fingerprint = localStorage.getItem("submission-fingerprint");
  if (!fingerprint) {
    fingerprint = crypto.randomUUID();
    localStorage.setItem("submission-fingerprint", fingerprint);
  }
  const { data, error } = await supabase.functions.invoke("submit-place", {
    body: { payload, turnstileToken, fingerprint, submissionId },
  });
  if (error) {
    let message = error.message;
    try {
      const responseBody = await error.context?.json();
      message = responseBody?.error || message;
    } catch {
      // Keep the SDK message when the function response is not JSON.
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data.queryCode;
}

export async function submitPlaceWithImages(
  payload,
  files = [],
  turnstileToken,
) {
  if (!supabase) throw new Error("Supabase 未配置");
  const submissionId = crypto.randomUUID();
  const imagePaths = [];
  for (const sourceFile of files) {
    const file = await compressImageToWebp(sourceFile);
    const path = `${submissionId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
    const { error } = await supabase.storage
      .from("submission-images")
      .upload(path, file, { upsert: false, contentType: file.type });
    if (error) throw error;
    imagePaths.push(path);
  }
  return submitPlace(
    {
      ...payload,
      custom_details: { ...(payload.custom_details || {}), images: imagePaths },
    },
    turnstileToken,
    submissionId,
  );
}

export async function getSubmissionStatus(queryCode) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase.rpc("get_submission_status", {
    code: queryCode.trim(),
  });
  if (error) throw error;
  return data?.[0] || null;
}

export async function signInAdmin(email, password) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  const { data: membership, error: membershipError } = await supabase
    .from("admin_users")
    .select("email")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (membershipError || !membership) {
    await supabase.auth.signOut();
    throw new Error("该账号不是管理员");
  }
  return data.user;
}

export async function signOutAdmin() {
  await supabase?.auth.signOut();
}

export async function loadPendingPlaces() {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase
    .from("places")
    .select("*")
    .eq("status", "pending")
    .order("submitted_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function loadPlacesByStatus(status) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase
    .from("places")
    .select("*")
    .eq("status", status)
    .order("submitted_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function updatePlace(id, changes) {
  if (!supabase) throw new Error("Supabase 未配置");
  const placeId = requirePlaceId(id);
  const { data, error } = await supabase
    .from("places")
    .update(changes)
    .eq("id", placeId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletePlace(id) {
  if (!supabase) throw new Error("Supabase 未配置");
  const placeId = requirePlaceId(id);
  const { data: existing, error: fetchError } = await supabase
    .from("places")
    .select("image_urls,cover_url,custom_details")
    .eq("id", placeId)
    .single();
  if (fetchError) throw fetchError;
  const pendingPaths = existing.custom_details?.images || [];
  const publicPaths = (
    existing.image_urls?.length
      ? existing.image_urls
      : existing.cover_url
        ? [existing.cover_url]
        : []
  )
    .map(publicImagePathFromUrl)
    .filter(Boolean);
  if (pendingPaths.length) {
    const { error } = await supabase.storage
      .from("submission-images")
      .remove(pendingPaths);
    if (error) throw error;
  }
  if (publicPaths.length) {
    const { error } = await supabase.storage
      .from("place-images")
      .remove(publicPaths);
    if (error) throw error;
  }
  const { error } = await supabase
    .from("places")
    .delete()
    .eq("id", placeId);
  if (error) throw error;
}

export async function loadAdminCatalog() {
  if (!supabase) throw new Error("Supabase 未配置");
  const [categories, fields, reactions] = await Promise.all([
    supabase.from("categories").select("*").order("sort_order"),
    supabase.from("detail_fields").select("*").order("sort_order"),
    supabase.from("reaction_definitions").select("*").order("sort_order"),
  ]);
  if (categories.error || fields.error || reactions.error)
    throw categories.error || fields.error || reactions.error;
  return {
    categories: categories.data || [],
    fields: fields.data || [],
    reactions: reactions.data || [],
  };
}

export async function loadPlaceReactionOptions(placeIds = []) {
  if (!supabase || !placeIds.length) return [];
  const { data, error } = await supabase
    .from("place_reaction_options")
    .select("place_id,reaction_value,is_enabled")
    .in("place_id", placeIds);
  if (error) throw error;
  return data || [];
}

export async function loadPlaceReactionSummaries(placeIds = []) {
  if (!supabase || !placeIds.length) return [];
  const { data, error } = await supabase.rpc("get_place_reaction_summaries", {
    target_place_ids: placeIds,
  });
  if (error) throw error;
  return data || [];
}

export async function saveReactionDefinition(reaction) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase
    .from("reaction_definitions")
    .upsert(reaction)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteReactionDefinition(value) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { error } = await supabase
    .from("reaction_definitions")
    .delete()
    .eq("value", value);
  if (error) throw error;
}

export async function savePlaceReactionOption(
  placeId,
  reactionValue,
  isEnabled,
) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase
    .from("place_reaction_options")
    .upsert({
      place_id: placeId,
      reaction_value: reactionValue,
      is_enabled: isEnabled,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function savePlaceReactionCount(
  placeId,
  reactionValue,
  count,
) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { error } = await supabase.rpc("set_place_reaction_count", {
    target_place_id: placeId,
    target_reaction: reactionValue,
    target_count: count,
  });
  if (error) throw error;
}

export async function saveCategory(category) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase
    .from("categories")
    .upsert(category)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function saveDetailField(field) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase
    .from("detail_fields")
    .upsert(field)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteCategory(id) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data: referencedPlaces, error: referenceError } = await supabase
    .from("places")
    .select("id")
    .eq("category_id", id)
    .limit(1);
  if (referenceError) throw referenceError;
  if (referencedPlaces?.length)
    throw new Error("该分类仍被地点使用，请先修改相关地点的分类");
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteDetailField(key) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { error } = await supabase
    .from("detail_fields")
    .delete()
    .eq("key", key);
  if (error) throw error;
}

export async function createApprovedPlaceWithImages(payload, files = []) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user)
    throw userError || new Error("管理员登录已失效");
  const id = payload.id || crypto.randomUUID();
  const publicUrls = [];
  for (const sourceFile of files) {
    const file = await compressImageToWebp(sourceFile);
    const path = `${id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
    const { error } = await supabase.storage
      .from("place-images")
      .upload(path, file, { upsert: false, contentType: file.type });
    if (error) throw error;
    publicUrls.push(
      supabase.storage.from("place-images").getPublicUrl(path).data.publicUrl,
    );
  }
  const { data, error } = await supabase
    .from("places")
    .insert({
      ...payload,
      id,
      status: "approved",
      cover_url: publicUrls[0] || payload.cover_url || null,
      image_urls: publicUrls,
      reviewed_at: new Date().toISOString(),
      reviewed_by: userResult.user.id,
    })
    .select("query_code")
    .single();
  if (error) throw error;
  return data.query_code;
}

export async function loadPendingImageUrls(paths = []) {
  if (!supabase || !paths.length) return [];
  const { data, error } = await supabase.storage
    .from("submission-images")
    .createSignedUrls(paths, 3600);
  if (error) throw error;
  return (data || [])
    .map((item, index) => ({
      path: item.path || paths[index],
      url: item.signedUrl,
    }))
    .filter((item) => item.url);
}

const publicImagePathFromUrl = (url) => {
  if (typeof url !== "string") return null;
  const marker = "/storage/v1/object/public/place-images/";
  const markerIndex = url.indexOf(marker);
  return markerIndex >= 0
    ? decodeURIComponent(url.slice(markerIndex + marker.length))
    : null;
};

export async function removePendingImage(placeId, path) {
  if (!supabase) throw new Error("Supabase 未配置");
  const validPlaceId = requirePlaceId(placeId);
  const { data: existing, error: fetchError } = await supabase
    .from("places")
    .select("custom_details")
    .eq("id", validPlaceId)
    .single();
  if (fetchError) throw fetchError;
  const imagePaths = existing.custom_details?.images || [];
  if (!imagePaths.includes(path)) throw new Error("待审核图片不存在");
  const { error: storageError } = await supabase.storage
    .from("submission-images")
    .remove([path]);
  if (storageError) throw storageError;
  const { error } = await supabase
    .from("places")
    .update({
      custom_details: {
        ...(existing.custom_details || {}),
        images: imagePaths.filter((item) => item !== path),
      },
    })
    .eq("id", validPlaceId);
  if (error) throw error;
}

export async function uploadPublishedImages(placeId, files = []) {
  if (!supabase || !files.length) return;
  const validPlaceId = requirePlaceId(placeId);
  const { data: existing, error: fetchError } = await supabase
    .from("places")
    .select("image_urls,cover_url")
    .eq("id", validPlaceId)
    .single();
  if (fetchError) throw fetchError;
  const currentUrls = existing.image_urls?.length
    ? existing.image_urls
    : existing.cover_url
      ? [existing.cover_url]
      : [];
  if (currentUrls.length + files.length > 12)
    throw new Error("每个地点最多保留12张图片");
  const newUrls = [];
  for (const sourceFile of files) {
    const file = await compressImageToWebp(sourceFile);
    const path = `${validPlaceId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
    const { error } = await supabase.storage
      .from("place-images")
      .upload(path, file, { upsert: false, contentType: file.type });
    if (error) throw error;
    newUrls.push(
      supabase.storage.from("place-images").getPublicUrl(path).data.publicUrl,
    );
  }
  const imageUrls = [...currentUrls, ...newUrls];
  const { error } = await supabase
    .from("places")
    .update({
      image_urls: imageUrls,
      cover_url: existing.cover_url || imageUrls[0] || null,
    })
    .eq("id", validPlaceId);
  if (error) throw error;
}

export async function removePublishedImage(placeId, imageUrl) {
  if (!supabase) throw new Error("Supabase 未配置");
  const validPlaceId = requirePlaceId(placeId);
  const { data: existing, error: fetchError } = await supabase
    .from("places")
    .select("image_urls,cover_url")
    .eq("id", validPlaceId)
    .single();
  if (fetchError) throw fetchError;
  const currentUrls = existing.image_urls?.length
    ? existing.image_urls
    : existing.cover_url
      ? [existing.cover_url]
      : [];
  if (!currentUrls.includes(imageUrl)) throw new Error("图片不存在");
  const path = publicImagePathFromUrl(imageUrl);
  if (path) {
    const { error } = await supabase.storage
      .from("place-images")
      .remove([path]);
    if (error) throw error;
  }
  const imageUrls = currentUrls.filter((url) => url !== imageUrl);
  const coverUrl =
    existing.cover_url === imageUrl ? imageUrls[0] || null : existing.cover_url;
  const { error } = await supabase
    .from("places")
    .update({ image_urls: imageUrls, cover_url: coverUrl })
    .eq("id", validPlaceId);
  if (error) throw error;
}

export async function setPublishedCover(placeId, imageUrl) {
  if (!supabase) throw new Error("Supabase 未配置");
  const validPlaceId = requirePlaceId(placeId);
  const { data: existing, error: fetchError } = await supabase
    .from("places")
    .select("image_urls,cover_url")
    .eq("id", validPlaceId)
    .single();
  if (fetchError) throw fetchError;
  const currentUrls = existing.image_urls?.length
    ? existing.image_urls
    : existing.cover_url
      ? [existing.cover_url]
      : [];
  if (!currentUrls.includes(imageUrl)) throw new Error("图片不存在");
  const imageUrls = [
    imageUrl,
    ...currentUrls.filter((url) => url !== imageUrl),
  ];
  const { error } = await supabase
    .from("places")
    .update({ cover_url: imageUrl, image_urls: imageUrls })
    .eq("id", validPlaceId);
  if (error) throw error;
}

export async function reviewPlace(
  id,
  status,
  rejectionReason = "",
  changes = {},
) {
  if (!supabase) throw new Error("Supabase 未配置");
  const placeId = requirePlaceId(id);
  const { data: existing, error: fetchError } = await supabase
    .from("places")
    .select("*")
    .eq("id", placeId)
    .single();
  if (fetchError) throw fetchError;
  let coverUrl = existing.cover_url;
  let imageUrls = existing.image_urls?.length
    ? existing.image_urls
    : existing.cover_url
      ? [existing.cover_url]
      : [];
  const imagePaths = existing.custom_details?.images || [];
  if (status === "approved" && imagePaths.length) {
    const publicUrls = [];
    for (const path of imagePaths) {
      const { data: file, error: downloadError } = await supabase.storage
        .from("submission-images")
        .download(path);
      if (downloadError) throw downloadError;
      const publicPath = `${placeId}/${path.split("/").pop()}`;
      const { error: uploadError } = await supabase.storage
        .from("place-images")
        .upload(publicPath, file, { upsert: true, contentType: file.type });
      if (uploadError) throw uploadError;
      publicUrls.push(
        supabase.storage.from("place-images").getPublicUrl(publicPath).data
          .publicUrl,
      );
    }
    coverUrl = publicUrls[0] || coverUrl;
    imageUrls = publicUrls;
  }
  const { data: userResult } = await supabase.auth.getUser();
  const nextCustomDetails = {
    ...(existing.custom_details || {}),
    ...(changes.custom_details || {}),
  };
  if (status === "approved") delete nextCustomDetails.images;
  const { custom_details: _ignoredCustomDetails, ...plainChanges } = changes;
  const { data, error } = await supabase
    .from("places")
    .update({
      ...plainChanges,
      status,
      cover_url: coverUrl,
      image_urls: imageUrls,
      custom_details: nextCustomDetails,
      rejection_reason: rejectionReason || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: userResult.user?.id || null,
    })
    .eq("id", placeId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

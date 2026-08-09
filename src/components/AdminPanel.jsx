import React, { useEffect, useState } from "react";
import {
  deleteCategory,
  deleteDetailField,
  deletePlace,
  deleteReactionDefinition,
  loadAdminCatalog,
  loadPendingImageUrls,
  loadPlaceReactionOptions,
  loadPlacesByStatus,
  removePendingImage,
  removePublishedImage,
  reviewPlace,
  saveCategory,
  saveDetailField,
  savePlaceReactionOption,
  saveReactionDefinition,
  setPublishedCover,
  signInAdmin,
  signOutAdmin,
  updatePlace,
  uploadPublishedImages,
} from "../lib/supabase";
import ImageLightbox from "./ImageLightbox";

const blankCategory = () => ({
  id: "",
  label: "",
  color: "#5e8c73",
  sort_order: 0,
  is_active: true,
});
const blankField = () => ({
  key: "",
  label: "",
  default_value: "",
  sort_order: 0,
  is_active: true,
});
const blankReaction = () => ({
  value: "",
  emoji: "",
  label: "",
  sort_order: 0,
  is_active: true,
});

export default function AdminPanel({
  onClose,
  onPendingChange,
  onDataChanged,
  onPreviewPlace,
  onAdminAddPoint,
  adminAddEnabled,
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("pending");
  const [pending, setPending] = useState([]);
  const [published, setPublished] = useState([]);
  const [categories, setCategories] = useState([]);
  const [fields, setFields] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [placeReactionOptions, setPlaceReactionOptions] = useState({});
  const [edits, setEdits] = useState({});
  const [reason, setReason] = useState({});
  const [newCategory, setNewCategory] = useState(blankCategory());
  const [newField, setNewField] = useState(blankField());
  const [newReaction, setNewReaction] = useState(blankReaction());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [imagePreview, setImagePreview] = useState("");

  const loadAll = async () => {
    const [nextPending, nextPublished, catalog] = await Promise.all([
      loadPlacesByStatus("pending"),
      loadPlacesByStatus("approved"),
      loadAdminCatalog(),
    ]);
    const [withImages, reactionOptions] = await Promise.all([
      nextPending.map(async (item) => ({
        ...item,
        imageUrls: await loadPendingImageUrls(
          item.custom_details?.images || [],
        ),
      })),
      loadPlaceReactionOptions(nextPublished.map((item) => item.id)),
    ]);
    const optionsByPlace = reactionOptions.reduce((result, option) => {
      (result[option.place_id] ||= {})[option.reaction_value] =
        option.is_enabled;
      return result;
    }, {});
    setPending(withImages);
    setPublished(nextPublished);
    setCategories(catalog.categories);
    setFields(catalog.fields);
    setReactions(catalog.reactions);
    setPlaceReactionOptions(optionsByPlace);
  };
  const login = async () => {
    setBusy(true);
    setError("");
    try {
      const admin = await signInAdmin(email, password);
      setUser(admin);
      await loadAll();
    } catch (loginError) {
      setError(loginError.message || "登录失败");
    } finally {
      setBusy(false);
    }
  };
  const directFieldKeys = [
    "category_id",
    "address",
    "hours",
    "price",
    "best_for",
    "rating",
    "latitude",
    "longitude",
  ];
  const placeValue = (item, key) =>
    edits[item.id]?.[key] ?? item[key] ?? item.custom_details?.[key] ?? "";
  const buildPlaceChanges = (item) => {
    const draft = edits[item.id] || {};
    const changes = {};
    directFieldKeys.forEach((key) => {
      if (draft[key] === undefined) return;
      changes[key] =
        key === "rating"
          ? draft[key] === ""
            ? null
            : Number(draft[key])
          : draft[key] === ""
            ? null
            : draft[key];
    });
    const customDetails = { ...(item.custom_details || {}) };
    fields.forEach((field) => {
      if (directFieldKeys.includes(field.key) || draft[field.key] === undefined)
        return;
      customDetails[field.key] = draft[field.key];
    });
    if (Object.keys(customDetails).length)
      changes.custom_details = customDetails;
    if (draft.name !== undefined) changes.name = draft.name.trim();
    if (draft.recommendation !== undefined)
      changes.recommendation = draft.recommendation.trim();
    return changes;
  };
  const review = async (item, status) => {
    setBusy(true);
    setError("");
    try {
      await reviewPlace(
        item.id,
        status,
        reason[item.id],
        buildPlaceChanges(item),
      );
      await loadAll();
      onDataChanged?.();
    } catch (reviewError) {
      setError(reviewError.message || "审核失败");
    } finally {
      setBusy(false);
    }
  };
  const savePublished = async (item) => {
    setBusy(true);
    setError("");
    try {
      await updatePlace(item.id, buildPlaceChanges(item));
      await loadAll();
      onDataChanged?.();
    } catch (saveError) {
      setError(saveError.message || "保存失败");
    } finally {
      setBusy(false);
    }
  };
  const removePublished = async (id) => {
    if (!window.confirm("确定删除这个已发布地点吗？")) return;
    setBusy(true);
    try {
      await deletePlace(id);
      await loadAll();
      onDataChanged?.();
    } catch (deleteError) {
      setError(deleteError.message || "删除失败");
    } finally {
      setBusy(false);
    }
  };
  const saveNewCategory = async () => {
    if (!newCategory.id || !newCategory.label) return;
    setBusy(true);
    try {
      await saveCategory(newCategory);
      setNewCategory(blankCategory());
      await loadAll();
      onDataChanged?.();
    } catch (saveError) {
      setError(saveError.message || "分类保存失败");
    } finally {
      setBusy(false);
    }
  };
  const saveExistingCategory = async (category) => {
    setBusy(true);
    try {
      await saveCategory(category);
      await loadAll();
      onDataChanged?.();
    } catch (saveError) {
      setError(saveError.message || "分类保存失败");
    } finally {
      setBusy(false);
    }
  };
  const removeCategory = async (category) => {
    if (!window.confirm(`确定删除分类“${category.label}”吗？`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteCategory(category.id);
      await loadAll();
      onDataChanged?.();
    } catch (deleteError) {
      setError(deleteError.message || "分类删除失败");
    } finally {
      setBusy(false);
    }
  };
  const saveNewField = async () => {
    if (!newField.key || !newField.label) return;
    setBusy(true);
    try {
      await saveDetailField(newField);
      setNewField(blankField());
      await loadAll();
      onDataChanged?.();
    } catch (saveError) {
      setError(saveError.message || "字段保存失败");
    } finally {
      setBusy(false);
    }
  };
  const saveExistingField = async (field) => {
    setBusy(true);
    try {
      await saveDetailField(field);
      await loadAll();
      onDataChanged?.();
    } catch (saveError) {
      setError(saveError.message || "字段保存失败");
    } finally {
      setBusy(false);
    }
  };
  const removeField = async (field) => {
    if (!window.confirm(`确定删除详情字段“${field.label}”吗？`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteDetailField(field.key);
      await loadAll();
      onDataChanged?.();
    } catch (deleteError) {
      setError(deleteError.message || "字段删除失败");
    } finally {
      setBusy(false);
    }
  };
  const saveNewReaction = async () => {
    if (!newReaction.value || !newReaction.emoji || !newReaction.label) return;
    setBusy(true);
    setError("");
    try {
      await saveReactionDefinition({
        ...newReaction,
        value: newReaction.value.trim(),
        emoji: newReaction.emoji.trim(),
        label: newReaction.label.trim(),
        sort_order: Number(newReaction.sort_order) || 0,
      });
      setNewReaction(blankReaction());
      await loadAll();
      onDataChanged?.();
    } catch (saveError) {
      setError(saveError.message || "表情保存失败");
    } finally {
      setBusy(false);
    }
  };
  const saveExistingReaction = async (reaction) => {
    setBusy(true);
    setError("");
    try {
      await saveReactionDefinition({
        ...reaction,
        emoji: reaction.emoji.trim(),
        label: reaction.label.trim(),
        sort_order: Number(reaction.sort_order) || 0,
      });
      await loadAll();
      onDataChanged?.();
    } catch (saveError) {
      setError(saveError.message || "表情保存失败");
    } finally {
      setBusy(false);
    }
  };
  const removeReaction = async (reaction) => {
    if (!window.confirm(`确定删除表情“${reaction.label}”吗？`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteReactionDefinition(reaction.value);
      await loadAll();
      onDataChanged?.();
    } catch (deleteError) {
      setError(
        deleteError.message || "该表情已有响应或地点设置，无法删除",
      );
    } finally {
      setBusy(false);
    }
  };
  const togglePlaceReaction = async (placeId, reactionValue, isEnabled) => {
    setBusy(true);
    setError("");
    try {
      await savePlaceReactionOption(placeId, reactionValue, isEnabled);
      setPlaceReactionOptions((current) => ({
        ...current,
        [placeId]: {
          ...(current[placeId] || {}),
          [reactionValue]: isEnabled,
        },
      }));
      onDataChanged?.();
    } catch (saveError) {
      setError(saveError.message || "地点表情设置保存失败");
    } finally {
      setBusy(false);
    }
  };
  const removePendingImageFromPlace = async (item, path) => {
    if (!window.confirm("确定删除这张待审核图片吗？")) return;
    setBusy(true);
    setError("");
    try {
      await removePendingImage(item.id, path);
      await loadAll();
    } catch (imageError) {
      setError(imageError.message || "图片删除失败");
    } finally {
      setBusy(false);
    }
  };
  const addPublishedImages = async (item, event) => {
    const files = Array.from(event.target.files || []).slice(0, 12);
    event.target.value = "";
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      await uploadPublishedImages(item.id, files);
      await loadAll();
      onDataChanged?.();
    } catch (imageError) {
      setError(imageError.message || "图片上传失败");
    } finally {
      setBusy(false);
    }
  };
  const removePublishedImageFromPlace = async (item, url) => {
    if (!window.confirm("确定删除这张已发布图片吗？")) return;
    setBusy(true);
    setError("");
    try {
      await removePublishedImage(item.id, url);
      await loadAll();
      onDataChanged?.();
    } catch (imageError) {
      setError(imageError.message || "图片删除失败");
    } finally {
      setBusy(false);
    }
  };
  const makePublishedCover = async (item, url) => {
    setBusy(true);
    setError("");
    try {
      await setPublishedCover(item.id, url);
      await loadAll();
      onDataChanged?.();
    } catch (imageError) {
      setError(imageError.message || "封面设置失败");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);
  useEffect(
    () => () => {
      onPendingChange?.([]);
      if (user) signOutAdmin();
    },
    [user, onPendingChange],
  );

  const updateEdit = (id, key, value) =>
    setEdits((current) => ({
      ...current,
      [id]: { ...(current[id] || {}), [key]: value },
    }));
  const editor = (item) => edits[item.id] || {};
  const renderImageManager = (item, publishedMode) => {
    const images = publishedMode
      ? item.image_urls?.length
        ? item.image_urls
        : item.cover_url
          ? [item.cover_url]
          : []
      : item.imageUrls || [];
    return (
      <div
        className="admin-image-manager"
        onClick={(event) => event.stopPropagation()}
      >
        {images.length > 0 && (
          <div className="admin-image-grid">
            {images.map((image) => {
              const url = publishedMode ? image : image.url;
              const imageKey = publishedMode ? image : image.path;
              const isCover = publishedMode && item.cover_url === image;
              return (
                <div
                  className={`admin-image-item ${isCover ? "is-cover" : ""}`}
                  key={imageKey}
                >
                  <img src={url} alt="" onClick={() => setImagePreview(url)} />
                  <div className="admin-image-actions">
                    {publishedMode && (
                      <button
                        onClick={() => makePublishedCover(item, image)}
                        disabled={busy || isCover}
                      >
                        {isCover ? "当前封面" : "设为封面"}
                      </button>
                    )}
                    <button
                      className="danger-button"
                      onClick={() =>
                        publishedMode
                          ? removePublishedImageFromPlace(item, image)
                          : removePendingImageFromPlace(item, image.path)
                      }
                      disabled={busy}
                    >
                      删除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {publishedMode && (
          <label className="image-upload-button">
            追加图片
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) => addPublishedImages(item, event)}
              disabled={busy}
            />
          </label>
        )}
      </div>
    );
  };
  const renderPlaceEditor = (item, publishedMode = false) => (
    <article
      className="pending-card"
      key={item.id}
      onClick={() => onPreviewPlace?.(item)}
    >
      <h3 className="admin-card-heading">
        {publishedMode ? "已发布地点" : "待审核地点"}
      </h3>
      {renderImageManager(item, publishedMode)}
      <input
        className="pending-edit"
        value={placeValue(item, "name")}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => updateEdit(item.id, "name", event.target.value)}
      />
      <textarea
        rows="3"
        value={placeValue(item, "recommendation")}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) =>
          updateEdit(item.id, "recommendation", event.target.value)
        }
      />
      <div
        className="admin-detail-fields"
        onClick={(event) => event.stopPropagation()}
      >
        <label>
          <span>分类</span>
          <select
            value={placeValue(item, "category_id")}
            onChange={(event) =>
              updateEdit(item.id, "category_id", event.target.value)
            }
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>地址</span>
          <input
            value={placeValue(item, "address")}
            onChange={(event) =>
              updateEdit(item.id, "address", event.target.value)
            }
          />
        </label>
        {fields.map((field) => (
          <label key={field.key}>
            <span>{field.label}</span>
            <input
              type={field.key === "rating" ? "number" : "text"}
              step={field.key === "rating" ? "0.1" : undefined}
              value={placeValue(item, field.key)}
              onChange={(event) =>
                updateEdit(item.id, field.key, event.target.value)
              }
            />
          </label>
        ))}
      </div>
      <small>
        {Number(placeValue(item, "latitude") || item.latitude).toFixed(6)},{" "}
        {Number(placeValue(item, "longitude") || item.longitude).toFixed(6)} ·
        点击卡片定位
      </small>
      {publishedMode && reactions.some((reaction) => reaction.is_active) && (
        <div
          className="admin-place-reactions"
          onClick={(event) => event.stopPropagation()}
        >
          <span>此地点可用表情</span>
          <div>
            {reactions
              .filter((reaction) => reaction.is_active)
              .map((reaction) => {
                const isEnabled =
                  placeReactionOptions[item.id]?.[reaction.value] ?? true;
                return (
                  <label key={reaction.value} title={reaction.label}>
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      disabled={busy}
                      onChange={(event) =>
                        togglePlaceReaction(
                          item.id,
                          reaction.value,
                          event.target.checked,
                        )
                      }
                    />
                    <span aria-hidden="true">{reaction.emoji}</span>
                  </label>
                );
              })}
          </div>
        </div>
      )}
      {item.custom_details?.duplicate_candidates?.length > 0 && (
        <p className="duplicate-warning">
          疑似重复：
          {item.custom_details.duplicate_candidates
            .map((candidate) => candidate.name)
            .join("、")}
        </p>
      )}
      {publishedMode ? (
        <div onClick={(event) => event.stopPropagation()}>
          <button onClick={() => savePublished(item)} disabled={busy}>
            保存全部信息
          </button>
          <button
            className="danger-button"
            onClick={() => removePublished(item.id)}
            disabled={busy}
          >
            删除地点
          </button>
        </div>
      ) : (
        <>
          <textarea
            rows="2"
            placeholder="驳回原因（可选）"
            value={reason[item.id] || ""}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) =>
              setReason((current) => ({
                ...current,
                [item.id]: event.target.value,
              }))
            }
          />
          <div onClick={(event) => event.stopPropagation()}>
            <button onClick={() => review(item, "approved")} disabled={busy}>
              通过
            </button>
            <button
              className="danger-button"
              onClick={() => review(item, "rejected")}
              disabled={busy}
            >
              驳回
            </button>
          </div>
        </>
      )}
    </article>
  );

  return (
    <aside className="debug-panel admin-panel">
      <div className="drawer-heading">
        <div>
          <p className="section-kicker">ADMIN CONSOLE</p>
          <h2>管理后台</h2>
        </div>
        <button
          className="drawer-close"
          onClick={onClose}
          aria-label="关闭后台"
        >
          ×
        </button>
      </div>
      {!user ? (
        <div className="debug-form">
          <label>
            <span>管理员邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button
            className="copy-yaml"
            onClick={login}
            disabled={busy || !email || !password}
          >
            {busy ? "登录中…" : "登录管理后台"}
          </button>
        </div>
      ) : (
        <div className="admin-console">
          <button
            className={`admin-add-trigger ${adminAddEnabled ? "active" : ""}`}
            onClick={() => onAdminAddPoint?.(!adminAddEnabled)}
          >
            {adminAddEnabled ? "取消地图加点" : "管理员地图加点"}
          </button>
          <div className="admin-tabs">
            {[
              ["pending", `待审核 ${pending.length}`],
              ["published", `已发布 ${published.length}`],
              ["categories", "分类"],
              ["fields", "详情字段"],
              ["reactions", "表情"],
            ].map(([id, label]) => (
              <button
                className={tab === id ? "active" : ""}
                key={id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {error && <p className="form-error">{error}</p>}
          {tab === "pending" && (
            <div className="pending-list">
              {pending.map((item) => renderPlaceEditor(item))}
              {!pending.length && (
                <p className="form-muted">暂无待审核投稿。</p>
              )}
            </div>
          )}
          {tab === "published" && (
            <div className="pending-list">
              {published.map((item) => renderPlaceEditor(item, true))}
              {!published.length && (
                <p className="form-muted">暂无已发布地点。</p>
              )}
            </div>
          )}
          {tab === "categories" && (
            <div className="config-list">
              <div className="config-row new-row">
                <input
                  placeholder="id"
                  value={newCategory.id}
                  onChange={(event) =>
                    setNewCategory({ ...newCategory, id: event.target.value })
                  }
                />
                <input
                  placeholder="名称"
                  value={newCategory.label}
                  onChange={(event) =>
                    setNewCategory({
                      ...newCategory,
                      label: event.target.value,
                    })
                  }
                />
                <input
                  type="color"
                  value={newCategory.color}
                  onChange={(event) =>
                    setNewCategory({
                      ...newCategory,
                      color: event.target.value,
                    })
                  }
                />
                <span aria-hidden="true" />
                <button onClick={saveNewCategory}>新增</button>
              </div>
              {categories.map((category) => (
                <div className="config-row" key={category.id}>
                  <input value={category.id} disabled />
                  <input
                    value={category.label}
                    onChange={(event) =>
                      setCategories((items) =>
                        items.map((item) =>
                          item.id === category.id
                            ? { ...item, label: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <input
                    type="color"
                    value={category.color}
                    onChange={(event) =>
                      setCategories((items) =>
                        items.map((item) =>
                          item.id === category.id
                            ? { ...item, color: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <button onClick={() => saveExistingCategory(category)}>
                    保存
                  </button>
                  <button
                    className="danger-button"
                    onClick={() => removeCategory(category)}
                    disabled={busy}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
          {tab === "fields" && (
            <div className="config-list">
              <div className="config-row new-row">
                <input
                  placeholder="key"
                  value={newField.key}
                  onChange={(event) =>
                    setNewField({ ...newField, key: event.target.value })
                  }
                />
                <input
                  placeholder="标题"
                  value={newField.label}
                  onChange={(event) =>
                    setNewField({ ...newField, label: event.target.value })
                  }
                />
                <input
                  placeholder="默认值"
                  value={newField.default_value}
                  onChange={(event) =>
                    setNewField({
                      ...newField,
                      default_value: event.target.value,
                    })
                  }
                />
                <span aria-hidden="true" />
                <button onClick={saveNewField}>新增</button>
              </div>
              {fields.map((field) => (
                <div className="config-row" key={field.key}>
                  <input value={field.key} disabled />
                  <input
                    value={field.label}
                    onChange={(event) =>
                      setFields((items) =>
                        items.map((item) =>
                          item.key === field.key
                            ? { ...item, label: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <input
                    value={field.default_value || ""}
                    onChange={(event) =>
                      setFields((items) =>
                        items.map((item) =>
                          item.key === field.key
                            ? { ...item, default_value: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <button onClick={() => saveExistingField(field)}>保存</button>
                  <button
                    className="danger-button"
                    onClick={() => removeField(field)}
                    disabled={busy}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
          {tab === "reactions" && (
            <div className="config-list">
              <div className="reaction-config-row new-row">
                <input
                  placeholder="key"
                  value={newReaction.value}
                  onChange={(event) =>
                    setNewReaction({
                      ...newReaction,
                      value: event.target.value,
                    })
                  }
                />
                <input
                  placeholder="表情"
                  value={newReaction.emoji}
                  onChange={(event) =>
                    setNewReaction({
                      ...newReaction,
                      emoji: event.target.value,
                    })
                  }
                />
                <input
                  placeholder="名称"
                  value={newReaction.label}
                  onChange={(event) =>
                    setNewReaction({
                      ...newReaction,
                      label: event.target.value,
                    })
                  }
                />
                <input
                  type="number"
                  aria-label="排序"
                  value={newReaction.sort_order}
                  onChange={(event) =>
                    setNewReaction({
                      ...newReaction,
                      sort_order: event.target.value,
                    })
                  }
                />
                <button onClick={saveNewReaction} disabled={busy}>
                  新增
                </button>
              </div>
              {reactions.map((reaction) => (
                <div className="reaction-config-row" key={reaction.value}>
                  <input value={reaction.value} disabled />
                  <input
                    value={reaction.emoji}
                    aria-label={`${reaction.label}的表情`}
                    onChange={(event) =>
                      setReactions((items) =>
                        items.map((item) =>
                          item.value === reaction.value
                            ? { ...item, emoji: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <input
                    value={reaction.label}
                    aria-label={`${reaction.value}的名称`}
                    onChange={(event) =>
                      setReactions((items) =>
                        items.map((item) =>
                          item.value === reaction.value
                            ? { ...item, label: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <input
                    type="number"
                    aria-label={`${reaction.label}的排序`}
                    value={reaction.sort_order}
                    onChange={(event) =>
                      setReactions((items) =>
                        items.map((item) =>
                          item.value === reaction.value
                            ? { ...item, sort_order: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <button
                    onClick={() => saveExistingReaction(reaction)}
                    disabled={busy}
                  >
                    保存
                  </button>
                  <button
                    className="danger-button"
                    onClick={() => removeReaction(reaction)}
                    disabled={busy}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

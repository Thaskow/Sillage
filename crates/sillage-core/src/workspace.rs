use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{now_ms, Error, Result, Store};

pub const SCRATCH_ID: &str = "libre";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub category_id: Option<String>,
    pub default_profile_id: Option<String>,
    pub position: i64,
    pub pinned: bool,
    pub archived: bool,
    pub layout: Option<serde_json::Value>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub position: i64,
    pub collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct NewGroup {
    pub name: String,
    pub color: String,
    pub icon: String,
    pub category_id: Option<String>,
    pub default_profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct GroupPatch {
    pub name: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    #[serde(default, with = "double_option")]
    pub category_id: Option<Option<String>>,
    #[serde(default, with = "double_option")]
    pub default_profile_id: Option<Option<String>>,
    pub pinned: Option<bool>,
    pub archived: Option<bool>,
    #[serde(default, with = "double_option")]
    pub layout: Option<Option<serde_json::Value>>,
}

mod double_option {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<T: Serialize, S: Serializer>(
        v: &Option<Option<T>>,
        s: S,
    ) -> Result<S::Ok, S::Error> {
        match v {
            Some(inner) => inner.serialize(s),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
        d: D,
    ) -> Result<Option<Option<T>>, D::Error> {
        Option::<T>::deserialize(d).map(Some)
    }
}

const GROUP_COLS: &str = "id, name, color, icon, category_id, default_profile_id, position, pinned, archived, layout, created_at, updated_at";

fn group_from_row(r: &Row) -> rusqlite::Result<Group> {
    let layout: Option<String> = r.get(9)?;
    Ok(Group {
        id: r.get(0)?,
        name: r.get(1)?,
        color: r.get(2)?,
        icon: r.get(3)?,
        category_id: r.get(4)?,
        default_profile_id: r.get(5)?,
        position: r.get(6)?,
        pinned: r.get(7)?,
        archived: r.get(8)?,
        layout: layout.and_then(|l| serde_json::from_str(&l).ok()),
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
    })
}

fn clean_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::Invalid("le nom ne peut pas être vide".into()));
    }
    if name.chars().count() > 80 {
        return Err(Error::Invalid("le nom dépasse 80 caractères".into()));
    }
    Ok(name.to_string())
}

pub(crate) fn clean_color(color: &str) -> Result<String> {
    let ok = color.len() == 7
        && color.starts_with('#')
        && color[1..].chars().all(|c| c.is_ascii_hexdigit());
    if ok {
        Ok(color.to_ascii_lowercase())
    } else {
        Err(Error::Invalid(format!("couleur « {color} »")))
    }
}

fn clean_icon(icon: &str) -> Result<String> {
    let ok = !icon.is_empty()
        && icon.len() <= 40
        && icon
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if ok {
        Ok(icon.to_string())
    } else {
        Err(Error::Invalid(format!("icône « {icon} »")))
    }
}

impl Store {
    pub fn groups(&self) -> Result<Vec<Group>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {GROUP_COLS} FROM groups ORDER BY position, created_at"
        ))?;
        let rows = st.query_map([], group_from_row)?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn group(&self, id: &str) -> Result<Group> {
        self.conn
            .query_row(
                &format!("SELECT {GROUP_COLS} FROM groups WHERE id = ?1"),
                [id],
                group_from_row,
            )
            .optional()?
            .ok_or_else(|| Error::NotFound(format!("groupe {id}")))
    }

    pub fn create_group(&self, new: NewGroup) -> Result<Group> {
        let name = clean_name(&new.name)?;
        let color = clean_color(&new.color)?;
        let icon = clean_icon(&new.icon)?;
        let id = Uuid::new_v4().to_string();
        let now = now_ms();
        let position: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM groups",
            [],
            |r| r.get(0),
        )?;
        self.conn.execute(
            "INSERT INTO groups (id, name, color, icon, category_id, default_profile_id, position, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
            params![id, name, color, icon, new.category_id, new.default_profile_id, position, now],
        )?;
        self.group(&id)
    }

    pub fn update_group(&self, id: &str, patch: GroupPatch) -> Result<Group> {
        if id == SCRATCH_ID
            && (patch.archived == Some(true) || matches!(patch.category_id, Some(Some(_))))
        {
            return Err(Error::Invalid(
                "l'espace libre ne peut être ni archivé ni rangé dans une catégorie".into(),
            ));
        }
        let mut g = self.group(id)?;
        if let Some(n) = patch.name {
            g.name = clean_name(&n)?;
        }
        if let Some(c) = patch.color {
            g.color = clean_color(&c)?;
        }
        if let Some(i) = patch.icon {
            g.icon = clean_icon(&i)?;
        }
        if let Some(c) = patch.category_id {
            g.category_id = c;
        }
        if let Some(p) = patch.default_profile_id {
            g.default_profile_id = p;
        }
        if let Some(p) = patch.pinned {
            g.pinned = p;
        }
        if let Some(a) = patch.archived {
            g.archived = a;
        }
        if let Some(l) = patch.layout {
            g.layout = l;
        }
        let layout = g.layout.as_ref().map(serde_json::to_string).transpose()?;
        self.conn.execute(
            "UPDATE groups SET name=?2, color=?3, icon=?4, category_id=?5, default_profile_id=?6,
             pinned=?7, archived=?8, layout=?9, updated_at=?10 WHERE id=?1",
            params![
                id,
                g.name,
                g.color,
                g.icon,
                g.category_id,
                g.default_profile_id,
                g.pinned,
                g.archived,
                layout,
                now_ms()
            ],
        )?;
        self.group(id)
    }

    pub fn ensure_scratch_group(&self) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO groups (id, name, color, icon, category_id, default_profile_id, position, pinned, archived, layout, created_at, updated_at)
             VALUES (?1, 'Espace libre', '#6c6e75', 'waves', NULL, NULL, -1, 0, 0, NULL, ?2, ?2)",
            params![SCRATCH_ID, now_ms()],
        )?;
        Ok(())
    }

    pub fn delete_group(&self, id: &str) -> Result<()> {
        if id == SCRATCH_ID {
            return Err(Error::Invalid(
                "l'espace libre ne peut pas être supprimé".into(),
            ));
        }
        let n = self
            .conn
            .execute("DELETE FROM groups WHERE id = ?1", [id])?;
        if n == 0 {
            return Err(Error::NotFound(format!("groupe {id}")));
        }
        Ok(())
    }

    pub fn reorder_groups(&mut self, ordered_ids: &[String]) -> Result<Vec<Group>> {
        let tx = self.conn.transaction()?;
        for (i, id) in ordered_ids.iter().enumerate() {
            let n = tx.execute(
                "UPDATE groups SET position = ?2 WHERE id = ?1",
                params![id, i as i64],
            )?;
            if n == 0 {
                return Err(Error::NotFound(format!("groupe {id}")));
            }
        }
        tx.commit()?;
        self.groups()
    }

    pub fn duplicate_group(&mut self, id: &str) -> Result<Group> {
        let src = self.group(id)?;
        let copy = self.create_group(NewGroup {
            name: format!("{} (copie)", src.name).chars().take(80).collect(),
            color: src.color.clone(),
            icon: src.icon.clone(),
            category_id: src.category_id.clone(),
            default_profile_id: src.default_profile_id.clone(),
        })?;
        let now = now_ms();
        let tx = self.conn.transaction()?;
        {
            tx.execute(
                "INSERT INTO sessions (id, group_id, kind, title, profile_id, cwd, command, args, persistent, position, created_at)
                 SELECT lower(hex(randomblob(16))), ?2, kind, title, profile_id, cwd, command, args, persistent, position, ?3
                 FROM sessions WHERE group_id = ?1",
                params![id, copy.id, now],
            )?;
            tx.execute(
                "UPDATE groups SET layout = (SELECT layout FROM groups WHERE id = ?1) WHERE id = ?2",
                params![id, copy.id],
            )?;
        }
        tx.commit()?;
        self.group(&copy.id)
    }

    pub fn categories(&self) -> Result<Vec<Category>> {
        let mut st = self
            .conn
            .prepare("SELECT id, name, position, collapsed FROM categories ORDER BY position")?;
        let rows = st.query_map([], |r| {
            Ok(Category {
                id: r.get(0)?,
                name: r.get(1)?,
                position: r.get(2)?,
                collapsed: r.get(3)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }

    pub fn create_category(&self, name: &str) -> Result<Category> {
        let name = clean_name(name)?;
        let id = Uuid::new_v4().to_string();
        let position: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM categories",
            [],
            |r| r.get(0),
        )?;
        self.conn.execute(
            "INSERT INTO categories (id, name, position) VALUES (?1, ?2, ?3)",
            params![id, name, position],
        )?;
        Ok(Category {
            id,
            name,
            position,
            collapsed: false,
        })
    }

    pub fn update_category(
        &self,
        id: &str,
        name: Option<String>,
        collapsed: Option<bool>,
    ) -> Result<()> {
        if let Some(n) = name {
            self.conn.execute(
                "UPDATE categories SET name = ?2 WHERE id = ?1",
                params![id, clean_name(&n)?],
            )?;
        }
        if let Some(c) = collapsed {
            self.conn.execute(
                "UPDATE categories SET collapsed = ?2 WHERE id = ?1",
                params![id, c],
            )?;
        }
        Ok(())
    }

    pub fn delete_category(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM categories WHERE id = ?1", [id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scratch_group_is_permanent() {
        let s = Store::open_in_memory().unwrap();
        s.ensure_scratch_group().unwrap();
        s.ensure_scratch_group().unwrap();
        assert_eq!(s.group(SCRATCH_ID).unwrap().name, "Espace libre");
        assert!(s.delete_group(SCRATCH_ID).is_err());
        assert!(s
            .update_group(
                SCRATCH_ID,
                GroupPatch {
                    archived: Some(true),
                    ..Default::default()
                },
            )
            .is_err());
    }

    fn new(name: &str) -> NewGroup {
        NewGroup {
            name: name.into(),
            color: "#4F7A6A".into(),
            icon: "briefcase".into(),
            ..Default::default()
        }
    }

    #[test]
    fn create_list_and_order() {
        let s = Store::open_in_memory().unwrap();
        let a = s.create_group(new("Travail")).unwrap();
        let b = s.create_group(new(" Personnel ")).unwrap();
        assert_eq!(b.name, "Personnel");
        assert_eq!(a.color, "#4f7a6a");
        let ids: Vec<_> = s.groups().unwrap().into_iter().map(|g| g.id).collect();
        assert_eq!(ids, vec![a.id, b.id]);
    }

    #[test]
    fn rejects_invalid_input() {
        let s = Store::open_in_memory().unwrap();
        assert!(matches!(s.create_group(new("   ")), Err(Error::Invalid(_))));
        assert!(s
            .create_group(NewGroup {
                color: "red".into(),
                ..new("x")
            })
            .is_err());
        assert!(s
            .create_group(NewGroup {
                icon: "../x".into(),
                ..new("x")
            })
            .is_err());
    }

    #[test]
    fn patch_updates_only_given_fields() {
        let s = Store::open_in_memory().unwrap();
        let cat = s.create_category("Clients").unwrap();
        let g = s.create_group(new("CStonx")).unwrap();
        let g2 = s
            .update_group(
                &g.id,
                GroupPatch {
                    pinned: Some(true),
                    category_id: Some(Some(cat.id.clone())),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(g2.pinned);
        assert_eq!(g2.name, "CStonx");
        assert_eq!(g2.category_id.as_deref(), Some(cat.id.as_str()));
        let g3 = s
            .update_group(
                &g.id,
                GroupPatch {
                    category_id: Some(None),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(g3.category_id, None);
    }

    #[test]
    fn patch_json_distinguishes_absent_and_null() {
        let absent: GroupPatch = serde_json::from_str("{}").unwrap();
        assert_eq!(absent.category_id, None);
        let null: GroupPatch = serde_json::from_str(r#"{"categoryId":null}"#).unwrap();
        assert_eq!(null.category_id, Some(None));
    }

    #[test]
    fn deleting_category_ungroups() {
        let s = Store::open_in_memory().unwrap();
        let cat = s.create_category("Perso").unwrap();
        let g = s
            .create_group(NewGroup {
                category_id: Some(cat.id.clone()),
                ..new("Arise")
            })
            .unwrap();
        s.delete_category(&cat.id).unwrap();
        assert_eq!(s.group(&g.id).unwrap().category_id, None);
    }

    #[test]
    fn reorder_and_unknown_id() {
        let mut s = Store::open_in_memory().unwrap();
        let a = s.create_group(new("A")).unwrap();
        let b = s.create_group(new("B")).unwrap();
        let got = s.reorder_groups(&[b.id.clone(), a.id.clone()]).unwrap();
        assert_eq!(got[0].id, b.id);
        assert!(s.reorder_groups(&["nope".into()]).is_err());
        assert_eq!(s.groups().unwrap()[0].id, b.id);
    }

    #[test]
    fn duplicate_copies_definitions_and_layout() {
        let mut s = Store::open_in_memory().unwrap();
        let g = s.create_group(new("Vigie")).unwrap();
        let layout = serde_json::json!({ "kind": "split", "dir": "row" });
        s.update_group(
            &g.id,
            GroupPatch {
                layout: Some(Some(layout.clone())),
                ..Default::default()
            },
        )
        .unwrap();
        s.conn
            .execute(
                "INSERT INTO sessions (id, group_id, kind, title, position, created_at) VALUES ('s1', ?1, 'powershell', 'PS', 0, 0)",
                [&g.id],
            )
            .unwrap();
        let copy = s.duplicate_group(&g.id).unwrap();
        assert_eq!(copy.name, "Vigie (copie)");
        assert_eq!(copy.layout, Some(layout));
        let n: i64 = s
            .conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE group_id = ?1",
                [&copy.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn delete_cascades_sessions() {
        let s = Store::open_in_memory().unwrap();
        let g = s.create_group(new("Tmp")).unwrap();
        s.conn
            .execute(
                "INSERT INTO sessions (id, group_id, kind, title, position, created_at) VALUES ('s1', ?1, 'cmd', 'CMD', 0, 0)",
                [&g.id],
            )
            .unwrap();
        s.delete_group(&g.id).unwrap();
        let n: i64 = s
            .conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
        assert!(matches!(s.delete_group(&g.id), Err(Error::NotFound(_))));
    }
}

import { useCharacterStore, useItemStore, useLocationStore, useChapterStore } from '@/stores';
import { useState, useMemo } from 'react';
import { Users, Package, MapPin } from 'lucide-react';

type EntityType = 'characters' | 'items' | 'locations';

export function Heatmap() {
  const [entityType, setEntityType] = useState<EntityType>('characters');
  const characters = useCharacterStore((s) => s.characters);
  const items = useItemStore((s) => s.items);
  const locations = useLocationStore((s) => s.locations);
  const chapters = useChapterStore((s) => s.chapters);

  const entities = useMemo(() => {
    switch (entityType) {
      case 'characters': return characters;
      case 'items': return items;
      case 'locations': return locations;
    }
  }, [entityType, characters, items, locations]);

  // 计算热力数据：entity × 章节 的 0/1 二值出现矩阵
  const heatData = useMemo(() => {
    return entities.map((entity) => {
      return chapters.map((chapter) => {
        const present = entity.chapters?.includes(chapter.order) ?? false;
        return present ? 1 : 0;
      });
    });
  }, [entities, chapters]);

  const getColor = (value: number) => {
    if (value === 0) return 'var(--muted)';
    return 'oklch(0.55 0.15 250)';
  };

  const typeIcons = {
    characters: <Users size={14} />,
    items: <Package size={14} />,
    locations: <MapPin size={14} />,
  };

  const typeLabels = {
    characters: '角色',
    items: '物品',
    locations: '地点',
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="font-semibold text-sm">📊 出现热力图</h2>
          <div className="flex-1" />
          {(['characters', 'items', 'locations'] as EntityType[]).map((type) => (
            <button
              key={type}
              onClick={() => setEntityType(type)}
              className={`flex items-center gap-1 px-2 py-1 text-xs rounded-xl ${
                entityType === type ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'
              }`}
            >
              {typeIcons[type]}
              {typeLabels[type]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {entities.length === 0 || chapters.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <p>暂无数据，请先创建角色和章节</p>
          </div>
        ) : (
          <div className="inline-block">
            {/* 章节标题 */}
            <div className="flex">
              <div className="w-24 shrink-0" />
              {chapters.map((ch) => (
                <div
                  key={ch.id}
                  className="w-8 text-center text-xs text-muted-foreground truncate"
                  title={ch.title}
                >
                  {ch.order}
                </div>
              ))}
            </div>

            {/* 热力行 */}
            {entities.map((entity, ei) => (
              <div key={entity.id} className="flex items-center">
                <div className="w-24 text-xs truncate pr-2 text-right shrink-0">
                  {'name' in entity ? String(entity.name) : ''}
                </div>
                {heatData[ei]?.map((value, ci) => (
                  <div
                    key={ci}
                    className="w-8 h-8 border border-background flex items-center justify-center text-xs"
                    style={{ backgroundColor: getColor(value) }}
                    title={`${'name' in entity ? String(entity.name) : ''} · 第${ci + 1}章: ${value}次`}
                  >
                    {value > 0 ? value : ''}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

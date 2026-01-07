import type { NamingStrategyInterface } from "typeorm";
import { DefaultNamingStrategy } from "typeorm";

function toSnakeCase(str: string): string {
  return str
    .replace(/[\s\-]+/g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/__/g, "_")
    .toLowerCase();
}

export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override tableName(className: string, customName?: string): string {
    return customName ?? toSnakeCase(className);
  }

  override columnName(propertyName: string, customName?: string, embeddedPrefixes: string[] = []): string {
    if (customName) return customName;
    const prefix = embeddedPrefixes.length ? `${embeddedPrefixes.map(toSnakeCase).join("_")}_` : "";
    return `${prefix}${toSnakeCase(propertyName)}`;
  }

  override relationName(propertyName: string): string {
    return toSnakeCase(propertyName);
  }

  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return `${toSnakeCase(relationName)}_${toSnakeCase(referencedColumnName)}`;
  }

  joinTableName(
    firstTableName: string,
    secondTableName: string,
    firstPropertyName: string,
    secondPropertyName: string,
  ): string {
    return toSnakeCase(`${firstTableName}_${firstPropertyName}_${secondTableName}`);
  }

  joinTableColumnName(tableName: string, propertyName: string, columnName?: string): string {
    return toSnakeCase(`${tableName}_${columnName ?? propertyName}`);
  }

  joinTableInverseColumnName(tableName: string, propertyName: string, columnName?: string): string {
    return this.joinTableColumnName(tableName, propertyName, columnName);
  }

  classTableInheritanceParentColumnName(parentTableName: string, parentTableIdPropertyName: string): string {
    return toSnakeCase(`${parentTableName}_${parentTableIdPropertyName}`);
  }
}



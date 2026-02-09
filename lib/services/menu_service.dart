import 'package:cloud_firestore/cloud_firestore.dart';

class MenuService {
  MenuService({FirebaseFirestore? firestore})
      : _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseFirestore _firestore;

  CollectionReference<Map<String, dynamic>> get menuRef =>
      _firestore.collection('menu_items');

  Stream<QuerySnapshot<Map<String, dynamic>>> watchMenu() {
    return menuRef.orderBy('createdAt', descending: true).snapshots();
  }

  Future<void> addMenuItem({
    required String name,
    required String description,
    required int quantity,
    required int price,
    required bool enabled,
  }) async {
    await menuRef.add({
      'name': name,
      'description': description,
      'quantity': quantity,
      'price': price,
      'enabled': enabled,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> updateMenuItem(
    String id, {
    required String name,
    required String description,
    required int quantity,
    required int price,
    required bool enabled,
  }) {
    return menuRef.doc(id).update({
      'name': name,
      'description': description,
      'quantity': quantity,
      'price': price,
      'enabled': enabled,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> toggleEnabled(String id, bool enabled) {
    return menuRef.doc(id).update({
      'enabled': enabled,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> deleteMenuItem(String id) {
    return menuRef.doc(id).delete();
  }
}
